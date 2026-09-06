import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { test, before, after } from "node:test";
import { spawn } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;
const port = Number(process.env.BOND402_TEST_PORT || 18123);
const baseUrl = `http://127.0.0.1:${port}`;
const testPrefix = `bond402-public-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let server;

function runSql(sql) {
  if (!databaseUrl) throw new Error("DATABASE_URL ist für die öffentlichen MVP-Tests erforderlich.");
  return execFileSync(
    "psql",
    [databaseUrl, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function cleanupTestData() {
  if (!databaseUrl) return;
  const emailFilter = `${testPrefix}%@example.test`;
  runSql(`
    DELETE FROM bond402_sessions
    WHERE user_id IN (SELECT id FROM bond402_users WHERE email LIKE '${emailFilter}');
    DELETE FROM bond402_api_rate_limits
    WHERE identity IN (
      SELECT 'owner:' || id FROM bond402_users WHERE email LIKE '${emailFilter}'
    )
    OR identity IN (
      SELECT 'key:' || id FROM bond402_api_keys
      WHERE owner_id IN (SELECT id FROM bond402_users WHERE email LIKE '${emailFilter}')
    );
    DELETE FROM bond402_api_keys
    WHERE owner_id IN (SELECT id FROM bond402_users WHERE email LIKE '${emailFilter}');
    DELETE FROM bond402_api_services
    WHERE owner_id IN (SELECT id FROM bond402_users WHERE email LIKE '${emailFilter}');
    DELETE FROM bond402_users WHERE email LIKE '${emailFilter}';
  `);
}

class CookieJar {
  value = "";

  capture(response) {
    const setCookie = response.headers.get("set-cookie");
    const match = setCookie?.match(/bond402_session=([^;]+)/);
    if (match) this.value = match[1];
  }

  header() {
    return this.value ? `bond402_session=${this.value}` : "";
  }
}

async function request(path, options = {}) {
  const { jar, body, headers = {}, ...fetchOptions } = options;
  const requestHeaders = { ...headers };
  if (jar?.header()) requestHeaders.Cookie = jar.header();
  if (body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
    fetchOptions.method ||= "POST";
    fetchOptions.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...fetchOptions,
    headers: requestHeaders,
  });
  jar?.capture(response);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { response, data };
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
  throw new Error("Der Test-API-Server wurde nicht rechtzeitig erreichbar.");
}

before(async () => {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL ist für die öffentlichen MVP-Tests erforderlich.");
  }
  cleanupTestData();
  server = spawn("node", ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"], {
    env: { ...process.env, NODE_ENV: "test", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (chunk) => {
    process.stderr.write(`[public-mvp-api] ${chunk}`);
  });
  await waitForServer();
});

after(async () => {
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await once(server, "exit").catch(() => {});
  }
  cleanupTestData();
});

test("öffentliche MVP-Sicherheits- und Kernflüsse", async () => {
  const emailA = `${testPrefix}-a@example.test`;
  const emailB = `${testPrefix}-b@example.test`;
  const passwordA = "Public-Mvp-A-123!";
  const passwordB = "Public-Mvp-B-123!";
  const jarA = new CookieJar();
  const jarB = new CookieJar();

  const health = await request("/api/healthz");
  assert.equal(health.response.status, 200);
  assert.equal(health.response.headers.get("cache-control"), "no-store");
  assert.equal(health.response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(health.response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(health.response.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=(), payment=()");

  const readiness = await request("/api/readyz");
  assert.equal(readiness.response.status, 200);
  assert.deepEqual(readiness.data, { status: "ok" });

  // The helper sends no body here; send a deliberately malformed payload directly.
  const malformedResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{\"email\":",
  });
  const malformedData = await malformedResponse.json();
  assert.equal(malformedResponse.status, 400);
  assert.equal(malformedData.code, "INVALID_JSON");

  const invalidRegister = await request("/api/auth/register", {
    body: { name: " ", email: `${testPrefix}-invalid@example.test`, password: "short" },
    headers: { "X-Forwarded-For": "203.0.113.1" },
  });
  assert.equal(invalidRegister.response.status, 400);
  assert.equal(invalidRegister.data.code, "INVALID_INPUT");

  for (let index = 0; index < 5; index += 1) {
    const registration = await request("/api/auth/register", {
      body: {
        name: `Rate-Limit-Konto ${index}`,
        email: `${testPrefix}-rate-${index}@example.test`,
        password: "Rate-Limit-123!",
      },
      headers: { "X-Forwarded-For": "203.0.113.50" },
    });
    assert.equal(registration.response.status, 201);
  }
  const rateLimitedRegistration = await request("/api/auth/register", {
    body: {
      name: "Rate-Limit-Konto 6",
      email: `${testPrefix}-rate-6@example.test`,
      password: "Rate-Limit-123!",
    },
    headers: { "X-Forwarded-For": "203.0.113.50" },
  });
  assert.equal(rateLimitedRegistration.response.status, 429);

  const registeredA = await request("/api/auth/register", {
    jar: jarA,
    body: { name: "Testkonto A", email: emailA, password: passwordA },
  });
  assert.equal(registeredA.response.status, 201);
  assert.ok(jarA.value);

  const registeredB = await request("/api/auth/register", {
    jar: jarB,
    body: { name: "Testkonto B", email: emailB, password: passwordB },
  });
  assert.equal(registeredB.response.status, 201);
  assert.ok(jarB.value);

  const meA = await request("/api/auth/me", { jar: jarA });
  assert.equal(meA.response.status, 200);
  assert.equal(meA.data.user.email, emailA);

  const wrongPasswordChange = await request("/api/auth/password", {
    method: "PUT",
    jar: jarA,
    body: { currentPassword: "wrong-password", newPassword: "New-Public-Mvp-123!" },
  });
  assert.equal(wrongPasswordChange.response.status, 401);

  const changedPassword = await request("/api/auth/password", {
    method: "PUT",
    jar: jarA,
    body: { currentPassword: passwordA, newPassword: "New-Public-Mvp-123!" },
  });
  assert.equal(changedPassword.response.status, 204);

  const oldPasswordLogin = await request("/api/auth/login", {
    body: { email: emailA, password: passwordA },
    headers: { "X-Forwarded-For": "203.0.113.5" },
  });
  assert.equal(oldPasswordLogin.response.status, 401);

  const newPasswordLogin = await request("/api/auth/login", {
    jar: jarA,
    body: { email: emailA, password: "New-Public-Mvp-123!" },
  });
  assert.equal(newPasswordLogin.response.status, 200);

  const wrongLogin = await request("/api/auth/login", {
    body: { email: emailA, password: "wrong-password" },
    headers: { "X-Forwarded-For": "203.0.113.2" },
  });
  assert.equal(wrongLogin.response.status, 401);

  const serviceCreated = await request("/api/services", {
    method: "POST",
    jar: jarA,
    body: {
      name: "Öffentlicher Testdienst",
      url: "https://example.com",
      expectedStructure: "html",
      maxResponseTime: 2000,
    },
  });
  assert.equal(serviceCreated.response.status, 201);
  const serviceId = serviceCreated.data.id;
  assert.ok(serviceId);

  const liveCheck = await request(`/api/services/${serviceId}/checks`, {
    method: "POST",
    jar: jarA,
  });
  assert.equal(liveCheck.response.status, 201);
  assert.ok(["PASS", "FAIL", "REVIEW"].includes(liveCheck.data.status));

  const manualCheck = await request(`/api/services/${serviceId}/verify`, {
    method: "POST",
    jar: jarA,
    body: { actualResponse: "<html><body>Bond402 test</body></html>" },
  });
  assert.equal(manualCheck.response.status, 201);
  assert.equal(manualCheck.data.checkType, "MANUAL");

  const servicesB = await request("/api/services", { jar: jarB });
  assert.equal(servicesB.response.status, 200);
  assert.deepEqual(servicesB.data, []);

  for (const [method, body] of [
    ["GET", undefined],
    ["PATCH", { name: "Fremder Zugriff" }],
    ["DELETE", undefined],
    ["POST", undefined],
  ]) {
    const path = method === "POST" ? `/api/services/${serviceId}/checks` : `/api/services/${serviceId}`;
    const foreign = await request(path, { method, jar: jarB, body });
    assert.equal(foreign.response.status, 404, `${method} auf fremden Dienst muss 404 liefern`);
  }

  const createdKey = await request("/api/api-keys", {
    method: "POST",
    jar: jarA,
    body: { name: "Automatischer MVP-Testschlüssel" },
  });
  assert.equal(createdKey.response.status, 201);
  assert.match(createdKey.data.secret, /^b402_/);

  const keysA = await request("/api/api-keys", { jar: jarA });
  assert.equal(keysA.response.status, 200);
  assert.equal(keysA.data.length, 1);
  assert.equal("secret" in keysA.data[0], false);

  const keysB = await request("/api/api-keys", { jar: jarB });
  assert.equal(keysB.response.status, 200);
  assert.deepEqual(keysB.data, []);

  const developerRead = await request(`/api/developer/services/${serviceId}`, {
    headers: { Authorization: `Bearer ${createdKey.data.secret}` },
  });
  assert.equal(developerRead.response.status, 200);

  const invalidKey = await request(`/api/developer/services/${serviceId}`, {
    headers: { Authorization: "Bearer b402_invalid-test-key", "X-Forwarded-For": "203.0.113.3" },
  });
  assert.equal(invalidKey.response.status, 401);
  let rateLimitedInvalidKey = null;
  for (let index = 0; index < 20; index += 1) {
    rateLimitedInvalidKey = await request(`/api/developer/services/${serviceId}`, {
      headers: { Authorization: "Bearer b402_invalid-test-key", "X-Forwarded-For": "203.0.113.3" },
    });
  }
  assert.equal(rateLimitedInvalidKey.response.status, 429);

  const revoked = await request(`/api/api-keys/${createdKey.data.id}`, {
    method: "DELETE",
    jar: jarA,
  });
  assert.equal(revoked.response.status, 204);

  const revokedKeyAccess = await request(`/api/developer/services/${serviceId}`, {
    headers: { Authorization: `Bearer ${createdKey.data.secret}`, "X-Forwarded-For": "203.0.113.4" },
  });
  assert.equal(revokedKeyAccess.response.status, 401);

  const loggedOut = await request("/api/auth/logout", { method: "POST", jar: jarA });
  assert.equal(loggedOut.response.status, 204);
  const afterLogout = await request("/api/auth/me", { jar: jarA });
  assert.equal(afterLogout.response.status, 401);

  const loggedInAgain = await request("/api/auth/login", {
    method: "POST",
    jar: jarA,
    body: { email: emailA, password: "New-Public-Mvp-123!" },
  });
  assert.equal(loggedInAgain.response.status, 200);
  const sessionHash = createHash("sha256").update(jarA.value, "utf8").digest("hex");
  runSql(`UPDATE bond402_sessions SET expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = '${sessionHash}'`);
  const expiredSession = await request("/api/auth/me", { jar: jarA });
  assert.equal(expiredSession.response.status, 401);
});