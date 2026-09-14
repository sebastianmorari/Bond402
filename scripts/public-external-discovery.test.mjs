import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PUBLIC_EXTERNAL_DISCOVERY_SCOPE,
  PUBLIC_EXTERNAL_DISCOVERY_SOURCE,
  PUBLIC_API_DIRECTORY_SCOPE,
  PUBLIC_API_DIRECTORY_SOURCE,
  PUBLIC_API_DIRECTORY_SOURCE_URL,
  dedupeExternalDiscoveryRecords,
  getCachedApisGuruCatalog,
  loadPublicApisCatalog,
  loadApisGuruCatalog,
  parsePublicApisCatalog,
  parseApisGuruCatalog,
  rankExternalDiscoveryResults,
  resetApisGuruCatalogCacheForTests,
  warmApisGuruCatalog,
} from "../artifacts/api-server/src/lib/public-external-discovery.ts";
import {
  rankPublicServiceResults,
  shouldUseExternalDiscoveryFallback,
} from "../artifacts/api-server/src/lib/public-service-search.ts";

const referenceNow = Date.parse("2026-09-12T12:00:00.000Z");

function record({ id, name, updatedAt = "2026-09-12T11:00:00.000Z", description = "Public API" }) {
  return {
    source: PUBLIC_EXTERNAL_DISCOVERY_SOURCE,
    sourceLabel: "APIs.guru OpenAPI-Verzeichnis",
    sourceUrl: "https://api.apis.guru/v2/list.json",
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

function publicApisRecord({ name, url = "https://directory.example.test/api" }) {
  return {
    source: PUBLIC_API_DIRECTORY_SOURCE,
    sourceLabel: "Public APIs Community-Verzeichnis",
    sourceUrl: PUBLIC_API_DIRECTORY_SOURCE_URL,
    id: `external:public-apis:${encodeURIComponent(url)}:directory`,
    provider: new URL(url).hostname,
    version: null,
    name,
    description: "Community directory metadata",
    categories: ["Testing"],
    openapiVersion: null,
    updatedAt: null,
    specificationUrl: url,
    sourceRecordUrl: PUBLIC_API_DIRECTORY_SOURCE_URL,
  };
}

test("ein beobachteter interner Teiltreffer bleibt vor externen Metadaten priorisiert", () => {
  const internal = rankPublicServiceResults(
    [
      {
        id: "internal-weather-status",
        name: "Wetter Status",
        url: "https://weather-status.internal.test",
        latestCheckAt: "2026-08-01T11:00:00.000Z",
        trustMetrics: { sampleCount: 5 },
      },
    ],
    "Wetter API",
    referenceNow,
  );
  const external = rankExternalDiscoveryResults(
    [record({ id: "external-weather", name: "Wetter API" })],
    "Wetter API",
    referenceNow,
  );

  assert.ok(internal[0].discovery.matchScore < 50);
  assert.equal(internal[0].discovery.rankingFactors.observationCoverage, 1);
  assert.equal(shouldUseExternalDiscoveryFallback("Wetter API", internal), false);
  assert.equal(external[0].verification.status, "UNVERIFIED_EXTERNAL");
});

test("externe Ergebnisse erscheinen nur als unverifizierter Fallback ohne interne Treffer", () => {
  const internal = rankPublicServiceResults(
    [
      {
        id: "internal-weather",
        name: "Wetter API",
        url: "https://weather.internal.test",
        latestCheckAt: null,
        trustMetrics: { sampleCount: 0 },
      },
    ],
    "Unbekannte API",
    referenceNow,
  );
  const external = rankExternalDiscoveryResults(
    [record({ id: "external-unknown", name: "Unbekannte API" })],
    "Unbekannte API",
    referenceNow,
  );

  assert.equal(shouldUseExternalDiscoveryFallback("Unbekannte API", internal), true);
  assert.equal(external.length, 1);
  assert.equal(external[0].kind, "EXTERNAL_DISCOVERY");
  assert.equal(external[0].verification.status, "UNVERIFIED_EXTERNAL");
  assert.equal(external[0].verification.reason, "SOURCE_METADATA_ONLY_NO_BOND402_CHECK");
  assert.equal("trustScore" in external[0], false);
  assert.equal(external[0].discovery.source, PUBLIC_EXTERNAL_DISCOVERY_SOURCE);
  assert.equal(external[0].discovery.evidence.sourceRecordUrl, external[0].links.sourceRecord);
  assert.equal(external[0].discovery.evidence.specificationUrl, external[0].links.specification);
  assert.doesNotMatch(JSON.stringify(external[0]), /apiKey|authorization|token|secret/i);
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

test("Public APIs-Verzeichnis wird aus belegbaren Markdown-Feldern normalisiert", () => {
  const parsed = parsePublicApisCatalog(`
## Index
### Weather
| API | Description | Auth | HTTPS | CORS |
|:---|:---|:---|:---|:---|
| [Weather Example](https://weather.example.test/docs?token=should-not-leak) | Current weather | apiKey | Yes | Yes |
| [Plain Example](http://plain.example.test) | Insecure | No | No | Unknown |
`);

  assert.equal(parsed.length, 0);
});

test("Public APIs-Verzeichnis übernimmt nur HTTPS-Links ohne Query-Secrets", () => {
  const parsed = parsePublicApisCatalog(`
## Index
### Weather
| API | Description | Auth | HTTPS | CORS |
|:---|:---|:---|:---|:---|
| [Weather Example](https://weather.example.test/docs) | Current weather | apiKey | Yes | Yes |
`);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].source, PUBLIC_API_DIRECTORY_SOURCE);
  assert.equal(parsed[0].sourceUrl, PUBLIC_API_DIRECTORY_SOURCE_URL);
  assert.equal(parsed[0].version, null);
  assert.equal(parsed[0].specificationUrl, "https://weather.example.test/docs");
  assert.doesNotMatch(JSON.stringify(parsed), /apiKey|token|secret|authorization/i);
});

test("neue externe Quelle lädt nur begrenzte, unverifizierte Verzeichnisdaten", async () => {
  resetApisGuruCatalogCacheForTests();
  const result = await loadPublicApisCatalog(async () => new Response(`
## Index
### Books
| API | Description | Auth | HTTPS | CORS |
|:---|:---|:---|:---|:---|
| [Books Example](https://books.example.test/docs) | Book data | No | Yes | Yes |
`, { status: 200 }), referenceNow);

  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.records[0].source, PUBLIC_API_DIRECTORY_SOURCE);
  assert.equal(result.records[0].sourceLabel, "Public APIs Community-Verzeichnis");
  const ranked = rankExternalDiscoveryResults(result.records, "Books", referenceNow);
  assert.equal(ranked[0].discovery.scope, PUBLIC_API_DIRECTORY_SCOPE);
  assert.equal(ranked[0].discovery.rankingFactors.openApiMetadata, 0);
});

test("externe Treffer werden gegen interne und andere externe URLs dedupliziert", () => {
  const duplicate = publicApisRecord({ name: "Duplicate", url: "https://same.example.test/api?utm_source=directory" });
  const sameAsInternal = publicApisRecord({ name: "Internal", url: "https://internal.example.test/api" });
  const unique = record({ id: "unique", name: "Unique API" });
  const deduped = dedupeExternalDiscoveryRecords(
    [duplicate, { ...duplicate, source: PUBLIC_EXTERNAL_DISCOVERY_SOURCE, id: "external:apis-guru:same:1", sourceLabel: "APIs.guru", sourceUrl: "https://api.apis.guru/v2/list.json" }, sameAsInternal, unique],
    ["https://internal.example.test/api/"],
  );

  assert.deepEqual(deduped.map((entry) => entry.name), ["Duplicate", "Unique API"]);
});

test("quellenübergreifende Duplikate bleiben ein Treffer und behalten alle öffentlichen Quellen", () => {
  const primary = publicApisRecord({
    name: "Duplicate",
    url: "https://same.example.test/api?utm_source=directory",
  });
  const secondary = {
    ...record({ id: "same", name: "Duplicate from APIs.guru" }),
    specificationUrl: "https://same.example.test/api/",
    sourceRecordUrl: "https://api.apis.guru/v2/specs/same/1.0.0.json",
  };

  const [deduped] = dedupeExternalDiscoveryRecords([primary, secondary]);

  assert.ok(deduped);
  assert.equal(deduped.source, primary.source);
  assert.equal(deduped.sourceLabel, primary.sourceLabel);
  assert.equal(deduped.sourceUrl, primary.sourceUrl);
  assert.deepEqual(
    deduped.sources,
    [
      { label: "APIs.guru OpenAPI-Verzeichnis", url: "https://api.apis.guru/v2/list.json" },
      { label: "Public APIs Community-Verzeichnis", url: PUBLIC_API_DIRECTORY_SOURCE_URL },
    ],
  );
});

test("Quellenliste ist begrenzt und deterministisch nach Label und URL sortiert", () => {
  const records = Array.from({ length: 5 }, (_, index) => ({
    ...publicApisRecord({
      name: "Bounded Sources",
      url: `https://same.example.test/api?source=${index}`,
    }),
    sourceLabel: ["Zulu", "Alpha", "Echo", "Bravo", "Charlie"][index],
    sourceUrl: `https://directory-${index}.example.test/catalog`,
    specificationUrl: "https://same.example.test/api/",
  }));

  const [deduped] = dedupeExternalDiscoveryRecords(records);

  assert.equal(deduped.sources.length, 4);
  assert.deepEqual(
    deduped.sources.map((source) => source.label),
    ["Alpha", "Bravo", "Charlie", "Echo"],
  );
});

test("Quellenliste enthält nur öffentliche Label/URLs und keine Eingabefelder", () => {
  const [deduped] = dedupeExternalDiscoveryRecords([
    {
      ...record({ id: "safe", name: "Safe API" }),
      ownerId: "private-owner",
      apiKey: "private-key",
      targetAuthSecretCiphertext: "private-secret",
    },
  ]);
  const [result] = rankExternalDiscoveryResults([deduped], "Safe API", referenceNow);

  assert.deepEqual(Object.keys(deduped.sources[0]).sort(), ["label", "url"]);
  assert.doesNotMatch(JSON.stringify(result), /private-owner|private-key|private-secret|authorization|token/i);
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

test("externe Discovery blockiert den internen Katalog bei leerem Cache nicht", async () => {
  resetApisGuruCatalogCacheForTests();
  let resolveFetch;
  const slowFetcher = () =>
    new Promise((resolve) => {
      resolveFetch = resolve;
    });

  assert.deepEqual(getCachedApisGuruCatalog(referenceNow), { status: "UNAVAILABLE", records: [] });
  const warmupResult = warmApisGuruCatalog(slowFetcher, referenceNow);
  assert.equal(warmupResult, undefined);
  assert.deepEqual(getCachedApisGuruCatalog(referenceNow), { status: "UNAVAILABLE", records: [] });

  resolveFetch(new Response(JSON.stringify({
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
  }), { status: 200 }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(getCachedApisGuruCatalog(referenceNow).status, "AVAILABLE");
});
