import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PUBLIC_EXTERNAL_DISCOVERY_SCOPE,
  PUBLIC_EXTERNAL_DISCOVERY_SOURCE,
  loadApisGuruCatalog,
  parseApisGuruCatalog,
  rankExternalDiscoveryResults,
  resetApisGuruCatalogCacheForTests,
} from "../artifacts/api-server/src/lib/public-external-discovery.ts";
import {
  rankPublicServiceResults,
  shouldUseExternalDiscoveryFallback,
} from "../artifacts/api-server/src/lib/public-service-search.ts";

const referenceNow = Date.parse("2026-09-12T12:00:00.000Z");

function record({ id, name, updatedAt = "2026-09-12T11:00:00.000Z", description = "Public API" }) {
  return {
    id,
    provider: `${id}.example`,
    version: "1.0.0",
    name,
    description,
    categories: ["weather"],
    openapiVersion: "3.0.0",
    updatedAt,
    specificationUrl: `https://api.apis.guru/v2/specs/${id}/1.0.0/openapi.json`,
    sourceRecordUrl: `https://api.apis.guru/v2/specs/${id}/1.0.0.json`,
  };
}

test("interne Treffer verhindern den externen Fallback deterministisch", () => {
  const internal = rankPublicServiceResults(
    [
      {
        id: "internal-weather",
        name: "Wetter API",
        url: "https://weather.internal.test",
        latestCheckAt: "2026-09-12T11:00:00.000Z",
        trustMetrics: { sampleCount: 5 },
      },
    ],
    "Wetter API",
    referenceNow,
  );

  assert.equal(shouldUseExternalDiscoveryFallback("Wetter API", internal), false);
  assert.equal(shouldUseExternalDiscoveryFallback("Unbekannte API", []), true);
  assert.equal(shouldUseExternalDiscoveryFallback("", []), false);
});

test("externe Treffer werden nachvollziehbar und unverifiziert gerankt", () => {
  const ranked = rankExternalDiscoveryResults(
    [
      record({ id: "generic", name: "Weather Status API", updatedAt: "2026-08-01T12:00:00.000Z" }),
      record({ id: "exact", name: "Weather API" }),
    ],
    "Weather API",
    referenceNow,
  );

  assert.deepEqual(
    ranked.map((entry) => entry.id),
    ["exact", "generic"],
  );
  assert.equal(ranked[0].kind, "EXTERNAL_DISCOVERY");
  assert.equal(ranked[0].discovery.source, PUBLIC_EXTERNAL_DISCOVERY_SOURCE);
  assert.equal(ranked[0].discovery.scope, PUBLIC_EXTERNAL_DISCOVERY_SCOPE);
  assert.equal(ranked[0].verification.status, "UNVERIFIED_EXTERNAL");
  assert.equal(ranked[0].verification.reason, "SOURCE_METADATA_ONLY_NO_BOND402_CHECK");
});

test("APIs.guru-Normalisierung übernimmt nur ableitbare OpenAPI-Felder", () => {
  const parsed = parseApisGuruCatalog({
    "weather.example": {
      preferred: "1.0.0",
      versions: {
        "1.0.0": {
          updated: "2026-09-12T11:00:00.000Z",
          openapiVer: "3.0.0",
          swaggerUrl: "https://api.apis.guru/v2/specs/weather.example/1.0.0/openapi.json",
          link: "https://api.apis.guru/v2/specs/weather.example/1.0.0.json",
          info: {
            title: "Weather API",
            description: "Public weather data",
            contact: { email: "private-looking@example.test" },
            "x-origin": [{ url: "https://not-used.example/openapi.json" }],
          },
        },
      },
    },
  });

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, "Weather API");
  assert.equal(parsed[0].specificationUrl, "https://api.apis.guru/v2/specs/weather.example/1.0.0/openapi.json");
  assert.doesNotMatch(JSON.stringify(parsed), /private-looking|not-used/);
});

test("eine blockierte öffentliche Quelle wird sicher übersprungen", async () => {
  resetApisGuruCatalogCacheForTests();
  const result = await loadApisGuruCatalog(async () => new Response("", { status: 402 }), referenceNow);
  assert.deepEqual(result, { status: "UNAVAILABLE", records: [] });
});

test("das aktuelle APIs.guru-Verzeichnis bleibt innerhalb des begrenzten Antwortlimits nutzbar", async () => {
  resetApisGuruCatalogCacheForTests();
  const payload = {
    "weather.example": {
      preferred: "1.0.0",
      versions: {
        "1.0.0": {
          updated: "2026-09-12T11:00:00.000Z",
          openapiVer: "3.0.0",
          swaggerUrl: "https://api.apis.guru/v2/specs/weather.example/1.0.0/openapi.json",
          info: { title: "Weather API" },
        },
      },
    },
  };
  const paddedResponse = `${JSON.stringify(payload)}${" ".repeat(8 * 1024 * 1024 + 1024)}`;
  const result = await loadApisGuruCatalog(
    async () => new Response(paddedResponse, { status: 200 }),
    referenceNow,
  );
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.records.length, 1);
});
