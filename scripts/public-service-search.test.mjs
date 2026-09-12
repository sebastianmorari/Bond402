import assert from "node:assert/strict";
import { test } from "node:test";
import { rankPublicServiceResults } from "../artifacts/api-server/src/lib/public-service-search.ts";

const referenceNow = Date.parse("2026-09-12T12:00:00.000Z");

function makeService({
  id,
  name,
  sampleCount = 0,
  latestCheckAt = null,
  url = `https://${id}.example.test`,
  extra = {},
}) {
  return {
    id,
    name,
    url,
    latestCheckAt,
    trustMetrics: { sampleCount },
    ...extra,
  };
}

test("internes Ranking verbindet Textrelevanz und gespeicherte Beobachtungen deterministisch", () => {
  const ranked = rankPublicServiceResults(
    [
      makeService({ id: "exact", name: "Wetter API" }),
      makeService({
        id: "observed",
        name: "Wetter API Status",
        sampleCount: 5,
        latestCheckAt: "2026-09-12T11:00:00.000Z",
      }),
    ],
    "Wetter API",
    referenceNow,
  );

  assert.deepEqual(
    ranked.map((entry) => entry.id),
    ["observed", "exact"],
  );
  assert.equal(ranked[0].discovery.source, "BOND402_INTERNAL_CATALOG");
  assert.equal(ranked[0].discovery.scope, "LISTED_SERVICES_ONLY");
  assert.equal(ranked[0].discovery.rankingFactors.observationCoverage, 1);
  assert.equal(ranked[0].discovery.rankingFactors.observationFreshness, 1);
});

test("bei gleichen Texttreffern entscheidet die Aktualität der Beobachtung reproduzierbar", () => {
  const ranked = rankPublicServiceResults(
    [
      makeService({
        id: "old",
        name: "Wetter Status",
        sampleCount: 5,
        latestCheckAt: "2026-08-01T12:00:00.000Z",
      }),
      makeService({
        id: "fresh",
        name: "Wetter Status",
        sampleCount: 5,
        latestCheckAt: "2026-09-12T11:00:00.000Z",
      }),
    ],
    "Wetter Status",
    referenceNow,
  );

  assert.deepEqual(
    ranked.map((entry) => entry.id),
    ["fresh", "old"],
  );
  assert.equal(ranked[0].discovery.rankingFactors.observationFreshness, 1);
  assert.equal(ranked[1].discovery.rankingFactors.observationFreshness, 0.25);
});

test("Ranking-Ergebnisse geben keine zusätzlichen Eingabefelder oder Secrets aus", () => {
  const [result] = rankPublicServiceResults(
    [
      makeService({
        id: "safe",
        name: "Sicherer Dienst",
        extra: {
          ownerId: "private-owner",
          targetAuthSecretCiphertext: "private-secret",
          apiKey: "private-key",
        },
      }),
    ],
    "",
    referenceNow,
  );

  assert.deepEqual(Object.keys(result), ["id", "discovery"]);
  assert.doesNotMatch(JSON.stringify(result), /private-owner|private-secret|private-key/);
  assert.equal(result.discovery.evidence.publicSourceUrl, "https://safe.example.test");
});