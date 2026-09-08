import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { test, before, after } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
const port = Number(process.env.BOND402_SERVICE_TEST_PORT || 18124);
const baseUrl = `http://127.0.0.1:${port}`;
const testId = randomUUID();
const userId = `service-route-test-${testId}`;
const email = `${testId}@service-route.test`;
const sessionToken = randomBytes(32).toString("base64url");
const sessionHash = createHash("sha256").update(sessionToken, "utf8").digest("hex");
let server;

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runSql(sql) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL ist für die Service-Routentests erforderlich.");
  }
  return execFileSync(
    "psql",
    [databaseUrl, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function cleanup() {
  if (!databaseUrl) return;
  runSql(`
    DELETE FROM bond402_sessions WHERE user_id = ${sqlLiteral(userId)};
    DELETE FROM bond402_api_services WHERE owner_id = ${sqlLiteral(userId)};
    DELETE FROM bond402_users WHERE id = ${sqlLiteral(userId)};
  `);
}

async function request(path, options = {}) {
  const { body, authenticated = false, ...fetchOptions } = options;
  const headers = { ...(body === undefined ? {} : { "Content-Type": "application/json" }) };
  if (authenticated) headers.Cookie = `bond402_session=${sessionToken}`;
  const response = await fetch(`${baseUrl}${path}`, {
    ...fetchOptions,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    response,
    data: text ? JSON.parse(text) : null,
  };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/healthz`);
      if (response.ok) return;
    } catch {
      // The child process may still be compiling or binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Der Service-Test-API-Server wurde nicht rechtzeitig erreichbar.");
}

before(async () => {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL ist für die Service-Routentests erforderlich.");
  }
  cleanup();
  runSql(`
    INSERT INTO bond402_users (id, email, display_name, password_hash, email_verification_required)
    VALUES (${sqlLiteral(userId)}, ${sqlLiteral(email)}, 'Service-Routentest', 'test-only', false);
    INSERT INTO bond402_sessions (id, user_id, token_hash, expires_at)
    VALUES (${sqlLiteral(randomUUID())}, ${sqlLiteral(userId)}, ${sqlLiteral(sessionHash)}, NOW() + INTERVAL '1 hour');
  `);

  server = spawn("node", ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (chunk) => {
    process.stderr.write(`[service-routes-api] ${chunk}`);
  });
  await waitForServer();
});

after(async () => {
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await once(server, "exit").catch(() => {});
  }
  cleanup();
});

test("Authentifizierter GET liefert eine Liste und POST legt einen Dienst an", async () => {
  const initial = await request("/api/services", { authenticated: true });
  assert.equal(initial.response.status, 200);
  assert.deepEqual(initial.data, []);

  const created = await request("/api/services", {
    method: "POST",
    authenticated: true,
    body: {
      name: "Deterministischer Routentest",
      url: "https://example.com",
      expectedStructure: "status",
      maxResponseTime: 1000,
    },
  });
  assert.equal(created.response.status, 201);
  assert.ok(created.data.id);
  assert.match(created.response.headers.get("x-request-id") ?? "", /\S/);

  const listed = await request("/api/services", { authenticated: true });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.data.length, 1);
  assert.equal(listed.data[0].id, created.data.id);
});

test("Services ohne Checks und mit historischer Check-Historie bleiben gültig", async () => {
  const withoutChecks = await request("/api/services", {
    method: "POST",
    authenticated: true,
    body: {
      name: "Dienst ohne Prüfungen",
      url: "https://example.com",
      expectedStructure: "status",
      maxResponseTime: 1200,
    },
  });
  assert.equal(withoutChecks.response.status, 201);
  assert.equal(withoutChecks.data.checks.length, 0);
  assert.equal(withoutChecks.data.trustScore, null);

  const withHistory = await request("/api/services", {
    method: "POST",
    authenticated: true,
    body: {
      name: "Dienst mit Historie",
      url: "https://example.com",
      expectedStructure: "status",
      maxResponseTime: 1200,
    },
  });
  assert.equal(withHistory.response.status, 201);

  runSql(`
    INSERT INTO bond402_api_checks (
      id, service_id, status, check_type, reachable, response_time_ms,
      structure_match, http_status, summary, found_fields, missing_fields,
      https, tls_status, security_headers, probe_region
    ) VALUES (
      ${sqlLiteral(randomUUID())}, ${sqlLiteral(withHistory.data.id)}, 'PASS', 'LIVE',
      true, 240, true, 200, 'Historischer Testwert',
      '["status"]'::jsonb, '[]'::jsonb, true, 'CHECKED',
      '{"status":"CHECKED","evaluated":[],"present":[],"missing":[]}'::jsonb,
      'test-region'
    );
  `);

  const listed = await request("/api/services", { authenticated: true });
  assert.equal(listed.response.status, 200);
  const emptyHistoryService = listed.data.find((service) => service.id === withoutChecks.data.id);
  const historicalService = listed.data.find((service) => service.id === withHistory.data.id);
  assert.ok(emptyHistoryService);
  assert.deepEqual(emptyHistoryService.checks, []);
  assert.ok(historicalService);
  assert.equal(historicalService.checks.length, 1);
  assert.equal(historicalService.checks[0].status, "PASS");
});

test("Fehlerhafte Services oder Checks beschädigen nicht die gültige Liste", async () => {
  const valid = await request("/api/services", {
    method: "POST",
    authenticated: true,
    body: {
      name: "Gültiger Dienst neben Fehler",
      url: "https://example.com",
      expectedStructure: "status",
      maxResponseTime: 1200,
    },
  });
  assert.equal(valid.response.status, 201);

  const serviceWithBadCheck = await request("/api/services", {
    method: "POST",
    authenticated: true,
    body: {
      name: "Dienst mit fehlerhafter Prüfung",
      url: "https://example.com",
      expectedStructure: "status",
      maxResponseTime: 1200,
    },
  });
  assert.equal(serviceWithBadCheck.response.status, 201);

  const badServiceId = randomUUID();
  runSql(`
    INSERT INTO bond402_api_services (
      id, owner_id, name, url, expected_structure, max_response_time, visibility
    ) VALUES (
      ${sqlLiteral(badServiceId)}, ${sqlLiteral(userId)}, 'Beschädigter Dienst',
      'https://bad-service.example.com', 'status', 1200, 'BROKEN'
    );
    INSERT INTO bond402_api_checks (
      id, service_id, status, check_type, reachable, response_time_ms,
      structure_match, http_status, summary, found_fields, missing_fields,
      https, tls_status, security_headers, probe_region
    ) VALUES (
      ${sqlLiteral(randomUUID())}, ${sqlLiteral(serviceWithBadCheck.data.id)}, 'BROKEN', 'LIVE',
      true, 240, true, 200, 'Beschädigter Testwert',
      '["status"]'::jsonb, '[]'::jsonb, true, 'CHECKED',
      '{"status":"CHECKED","evaluated":[],"present":[],"missing":[]}'::jsonb,
      'test-region'
    );
  `);

  const listed = await request("/api/services", { authenticated: true });
  assert.equal(listed.response.status, 200);
  assert.match(listed.response.headers.get("x-request-id") ?? "", /\S/);
  assert.ok(listed.data.some((service) => service.id === valid.data.id));
  const safeService = listed.data.find((service) => service.id === serviceWithBadCheck.data.id);
  assert.ok(safeService);
  assert.deepEqual(safeService.checks, []);
  assert.equal(listed.data.some((service) => service.id === badServiceId), false);
  assert.equal(listed.data.some((service) => service.name === "Gültiger Dienst neben Fehler"), true);
});

test("Fehlende Sitzung bleibt ein kontrollierter 401-Fehler mit Request-ID", async () => {
  const response = await request("/api/services");
  assert.equal(response.response.status, 401);
  assert.equal(response.data.code, "UNAUTHORIZED");
  assert.match(response.response.headers.get("x-request-id") ?? "", /\S/);

  const createResponse = await request("/api/services", {
    method: "POST",
    body: {
      name: "Nicht authentifiziert",
      url: "https://example.com",
      expectedStructure: "status",
      maxResponseTime: 1000,
    },
  });
  assert.equal(createResponse.response.status, 401);
  assert.equal(createResponse.data.code, "UNAUTHORIZED");
  assert.match(createResponse.response.headers.get("x-request-id") ?? "", /\S/);
});