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