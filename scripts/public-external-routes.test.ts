import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { test, before, after } from "node:test";
import {
  PUBLIC_EXTERNAL_DISCOVERY_SOURCE_URL,
  externalRecordId,
  resetApisGuruCatalogCacheForTests,
} from "../artifacts/api-server/src/lib/public-external-discovery";

const databaseUrl = process.env.DATABASE_URL;
const port = 18_129;
const baseUrl = `http://127.0.0.1:${port}`;
const sourceIp = "198.51.100.241";
const provider = "route-fixture.example";
const version = "1.0.0";
const serviceId = externalRecordId(provider, version);
const previousFetch = globalThis.fetch;
let server: ReturnType<(typeof import("node:http"))["createServer"]>;

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function runSql(sql: string) {
  if (!databaseUrl) throw new Error("DATABASE_URL ist für den externen Routentest erforderlich.");
  return execFileSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function request(path: string, options: RequestInit = {}) {
  const response = await previousFetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "X-Forwarded-For": sourceIp,
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  return { response, data: text ? JSON.parse(text) : null };
}

before(async () => {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL ist für den externen Routentest erforderlich.");
  }

  runSql(`DELETE FROM bond402_api_rate_limits WHERE identity = ${sqlLiteral(`public:${sourceIp}`)};`);
  runSql(`DELETE FROM bond402_public_discovery_records WHERE canonical_url = ${sqlLiteral("https://127.0.0.1/openapi.json")};`);
  resetApisGuruCatalogCacheForTests();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input) !== PUBLIC_EXTERNAL_DISCOVERY_SOURCE_URL) {
      throw new Error("Der Test darf keine weiteren externen Fetch-Ziele verwenden.");
    }
    return new Response(
      JSON.stringify({
        [provider]: {
          preferred: version,
          versions: {
            [version]: {
              info: { title: "Kontrollierter Routen-Fix", description: "Testkatalog" },
              swaggerUrl: "https://127.0.0.1/openapi.json",
              link: "https://127.0.0.1/record.json",
              openapiVer: "3.0.3",
              updated: "2026-09-13T00:00:00.000Z",
            },
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const { default: app } = await import("../artifacts/api-server/src/app");
  server = app.listen(port);
  await once(server, "listening");
});

after(async () => {
  globalThis.fetch = previousFetch;
  resetApisGuruCatalogCacheForTests();
  if (server) {
    server.close();
    await once(server, "close").catch(() => {});
  }
  runSql(`DELETE FROM bond402_public_discovery_records WHERE canonical_url = ${sqlLiteral("https://127.0.0.1/openapi.json")};`);
  runSql(`DELETE FROM bond402_api_rate_limits WHERE identity = ${sqlLiteral(`public:${sourceIp}`)};`);
});

test("Kalter externer Discovery-Fallback wartet einmalig auf den kostenlosen Katalog", async () => {
  resetApisGuruCatalogCacheForTests();
  const catalog = await request(
    `/api/public/services?q=${encodeURIComponent("Kontrollierter Routen-Fix")}`,
  );

  assert.equal(catalog.response.status, 200);
  assert.equal(catalog.data.source.mode, "EXTERNAL_FALLBACK");
  assert.equal(catalog.data.source.fallback, "USED");
  assert.equal(catalog.data.items.length, 1);
  assert.equal(catalog.data.items[0].kind, "EXTERNAL_DISCOVERY");
  assert.equal(catalog.data.items[0].verification.status, "UNVERIFIED_EXTERNAL");
  assert.equal(catalog.data.items[0].verification.reason, "SOURCE_METADATA_ONLY_NO_BOND402_CHECK");
});

test("Externaler Preflight bleibt bei blockiertem Loopback-Spezifikationsziel passiv", async () => {
  const preflight = await request(`/api/public/services/${encodeURIComponent(serviceId)}/external-preflight`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });

  assert.equal(preflight.response.status, 200);
  assert.equal(preflight.data.mode, "PASSIVE_ONLY");
  assert.equal(preflight.data.check.errorCode, "NO_SAFE_SERVER");
  assert.equal(preflight.data.safety.executedMethod, null);
  assert.equal(preflight.data.safety.secretsSent, false);
  assert.equal(preflight.data.verification.persisted, false);
});

test("Externaler Check lehnt ein nicht bestätigtes Prüfziel ab", async () => {
  const check = await request(`/api/public/services/${encodeURIComponent(serviceId)}/external-check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      method: "GET",
      path: "/",
      url: "https://127.0.0.1/",
    }),
  });

  assert.equal(check.response.status, 400);
  assert.equal(check.data.code, "UNSAFE_EXTERNAL_ENDPOINT");
});