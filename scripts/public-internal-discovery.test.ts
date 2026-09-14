import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPublicDiscoveryCandidate,
  dedupePublicDiscoveryCandidates,
  publicDiscoveryCandidateFromExternalRecord,
  publicDiscoveryId,
  upsertPublicDiscoveryRecords,
} from "../artifacts/api-server/src/lib/public-internal-discovery.ts";
import {
  rankPublicDiscoveryResults,
  shouldUseExternalDiscoveryFallback,
} from "../artifacts/api-server/src/lib/public-service-search.ts";
import {
  PUBLIC_EXTERNAL_DISCOVERY_SOURCE,
  PUBLIC_EXTERNAL_DISCOVERY_SOURCE_URL,
} from "../artifacts/api-server/src/lib/public-external-discovery.ts";

test("öffentliche Discovery-Deduplizierung ist über kanonische URL und ID stabil", () => {
  const first = buildPublicDiscoveryCandidate({
    url: "https://api.example.test/v1/?utm_source=directory",
    source: PUBLIC_EXTERNAL_DISCOVERY_SOURCE,
    sourceUrl: PUBLIC_EXTERNAL_DISCOVERY_SOURCE_URL,
    name: "Example API",
  });
  const second = buildPublicDiscoveryCandidate({
    url: "https://api.example.test/v1/",
    source: "OTHER_PUBLIC_SOURCE",
    sourceUrl: "https://directory.example.test/catalog",
    name: "Example API (zweite Quelle)",
  });

  assert.ok(first);
  assert.ok(second);
  assert.equal(first.canonicalUrl, second.canonicalUrl);
  assert.equal(first.id, second.id);
  assert.equal(first.id, publicDiscoveryId(first.canonicalUrl));
  assert.equal(
    dedupePublicDiscoveryCandidates([
      {
        url: first.canonicalUrl,
        source: first.source,
        sourceUrl: first.sourceUrl,
        name: first.name,
      },
      {
        url: second.canonicalUrl,
        source: second.source,
        sourceUrl: second.sourceUrl,
        name: second.name,
      },
    ]).length,
    1,
  );
});

test("Persistenz übernimmt ausschließlich die erlaubten öffentlichen Metadaten", async () => {
  const valuesSeen: unknown[] = [];
  const fakeExecutor = {
    insert() {
      const query = {
        values(values: unknown[]) {
          valuesSeen.push(values);
          return query;
        },
        onConflictDoUpdate() {
          return query;
        },
        returning() {
          return Promise.resolve(valuesSeen.at(-1) ?? []);
        },
      };
      return query;
    },
  };

  await upsertPublicDiscoveryRecords(
    [
      {
        url: "https://public.example.test/openapi.json",
        source: "PUBLIC_SOURCE",
        sourceUrl: "https://public.example.test/catalog",
        name: "Public Example",
        description: "Public metadata",
        provider: "public.example.test",
        version: "1.0.0",
      },
    ],
    fakeExecutor as never,
  );

  const [persisted] = valuesSeen[0] as Record<string, unknown>[];
  assert.deepEqual(Object.keys(persisted).sort(), [
    "canonicalUrl",
    "description",
    "discoveredAt",
    "id",
    "lastSeenAt",
    "name",
    "provider",
    "source",
    "sourceUrl",
    "trustStatus",
    "verificationStatus",
    "version",
  ]);
  assert.doesNotMatch(JSON.stringify(persisted), /owner|apiKey|authorization|token|secret/i);
});

test("persistierte interne Treffer werden vor dem externen Fallback berücksichtigt", () => {
  const ranked = rankPublicDiscoveryResults(
    [
      {
        id: "public-discovery:weather",
        canonicalUrl: "https://weather.example.test/openapi.json",
        source: PUBLIC_EXTERNAL_DISCOVERY_SOURCE,
        sourceUrl: PUBLIC_EXTERNAL_DISCOVERY_SOURCE_URL,
        name: "Wetter API",
        description: "Öffentliche Wetterdaten",
        provider: "weather.example.test",
        version: "1.0.0",
        discoveredAt: new Date("2026-09-12T11:00:00.000Z"),
        verificationStatus: "UNVERIFIED_EXTERNAL",
        trustStatus: "UNKNOWN",
      },
    ],
    "Wetter API",
    Date.parse("2026-09-12T12:00:00.000Z"),
  );

  assert.equal(ranked[0].kind, "INTERNAL_DISCOVERY");
  assert.equal(ranked[0].verification.status, "UNVERIFIED_EXTERNAL");
  assert.equal(ranked[0].trust.status, "UNKNOWN");
  assert.equal(
    shouldUseExternalDiscoveryFallback("Wetter API", [], ranked),
    false,
  );
  assert.doesNotMatch(JSON.stringify(ranked[0]), /apiKey|authorization|token|secret/i);
});

test("External-Records werden nur über belegte öffentliche Felder in Kandidaten überführt", () => {
  const candidate = publicDiscoveryCandidateFromExternalRecord({
    source: PUBLIC_EXTERNAL_DISCOVERY_SOURCE,
    sourceLabel: "APIs.guru",
    sourceUrl: PUBLIC_EXTERNAL_DISCOVERY_SOURCE_URL,
    id: "external:weather",
    provider: "weather.example.test",
    version: "1.0.0",
    name: "Wetter API",
    description: "Öffentliche Wetterdaten",
    categories: ["weather"],
    openapiVersion: "3.0.0",
    updatedAt: null,
    specificationUrl: "https://weather.example.test/openapi.json",
    sourceRecordUrl: "https://api.apis.guru/v2/specs/weather.json",
  });

  assert.deepEqual(candidate, {
    url: "https://weather.example.test/openapi.json",
    source: PUBLIC_EXTERNAL_DISCOVERY_SOURCE,
    sourceUrl: PUBLIC_EXTERNAL_DISCOVERY_SOURCE_URL,
    name: "Wetter API",
    description: "Öffentliche Wetterdaten",
    provider: "weather.example.test",
    version: "1.0.0",
    verificationStatus: "UNVERIFIED_EXTERNAL",
    trustStatus: "UNKNOWN",
  });
});