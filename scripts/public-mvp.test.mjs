import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { test, before, after } from "node:test";
import { spawn } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;
const port = Number(process.env.BOND402_TEST_PORT || 18123);
const baseUrl = `http://127.0.0.1:${port}`;
const testPrefix = `bond402-public-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let server;
let emailMockServer;
const mockEmails = [];

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
    DELETE FROM bond402_usage
      WHERE user_id IN (SELECT id FROM bond402_users WHERE email LIKE '${emailFilter}');
    DELETE FROM bond402_auth_tokens
      WHERE user_id IN (SELECT id FROM bond402_users WHERE email LIKE '${emailFilter}');
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
  emailMockServer = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let parsedBody;
      try {
        parsedBody = JSON.parse(body);
        if (parsedBody.to?.[0]?.includes("-delivery-fail@")) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "mock delivery failure" }));
          return;
        }
        mockEmails.push(parsedBody);
      } catch {
        // The API test fails later if the mock payload is not valid JSON.
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "mock-email-id" }));
    });
  });
  emailMockServer.listen(port + 1, "127.0.0.1");
  await once(emailMockServer, "listening");
  server = spawn("node", ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      RESEND_API_KEY: "test-resend-key",
      RESEND_API_URL: `http://127.0.0.1:${port + 1}/emails`,
      PUBLIC_BASE_URL: baseUrl,
      RESEND_FROM_EMAIL: "onboarding@resend.dev",
    },
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
  if (emailMockServer) {
    emailMockServer.close();
    await once(emailMockServer, "close").catch(() => {});
  }
  cleanupTestData();
});

async function waitForEmail(subject, startIndex = 0) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const email = mockEmails.slice(startIndex).find((candidate) => candidate.subject === subject);
    if (email) return email;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Keine Test-E-Mail mit Betreff "${subject}" erhalten.`);
}

function tokenFromEmail(email, path) {
  const match = String(email.text || "").match(new RegExp(`${path.replace("/", "\\/")}\\?token=([^\\s]+)`));
  if (!match) throw new Error(`Kein Token für ${path} in Test-E-Mail gefunden.`);
  return match[1];
}

test("öffentliche Beta-Discovery, Kataloggrenzen und OpenAPI-Vertrag", async () => {
  const discovery = await request("/api/public/discovery");
  assert.equal(discovery.response.status, 200);
  assert.equal(discovery.data.version, "public-beta");
  assert.equal(discovery.data.authentication.publicCatalog, "none");
  assert.equal(discovery.data.limits.publicCatalogRequestsPerMinutePerIp, 60);
  assert.match(discovery.data.endpoints.catalog, /\/api\/public\/services$/);

  const catalog = await request("/api/public/services?page=1&pageSize=2");
  assert.equal(catalog.response.status, 200);
  assert.equal(catalog.data.page, 1);
  assert.equal(catalog.data.pageSize, 2);
  assert.equal(catalog.data.sort, "name.asc,id.asc");
  assert.equal("ownerId" in catalog.data, false);
  assert.equal("keyHash" in catalog.data, false);
  assert.doesNotMatch(JSON.stringify(catalog.data), /api[_-]?key|session|password|ownerId|keyHash/i);

  const invalidPage = await request("/api/public/services?pageSize=51");
  assert.equal(invalidPage.response.status, 400);
  assert.equal(invalidPage.data.code, "INVALID_QUERY");

  const hiddenDetail = await request("/api/public/services/not-listed-in-public-beta");
  assert.equal(hiddenDetail.response.status, 404);
  assert.equal(hiddenDetail.data.code, "NOT_FOUND");

  const openApi = await request("/api/openapi.json");
  assert.equal(openApi.response.status, 200);
  assert.equal(openApi.data.openapi, "3.1.0");
  assert.ok(openApi.data.paths["/public/discovery"]);
  assert.ok(openApi.data.paths["/public/services"]);
  assert.ok(openApi.data.paths["/public/services/{id}/pre-action-check"].post);
  assert.ok(openApi.data.components.schemas.PublicPreActionCheck);
  assert.ok(openApi.data.components.schemas.TrustMetrics);
  assert.ok(openApi.data.components.schemas.SecurityHeaders);
  assert.ok(openApi.data.components.schemas.DomainVerification);
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

  const deliveryFailure = await request("/api/auth/register", {
    body: { name: "Versandfehler", email: `${testPrefix}-delivery-fail@example.test`, password: "Delivery-Fail-123!" },
    headers: { "X-Forwarded-For": "203.0.113.3" },
  });
  assert.equal(deliveryFailure.response.status, 503);
  assert.equal(deliveryFailure.data.code, "EMAIL_DELIVERY_FAILED");

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

  const verificationEmailIndex = mockEmails.length;
  const registeredA = await request("/api/auth/register", {
    jar: jarA,
    body: { name: "Testkonto A", email: emailA, password: passwordA },
  });
  assert.equal(registeredA.response.status, 201);
  assert.equal(jarA.value, "");
  assert.equal(registeredA.data.verificationRequired, true);
  assert.equal(registeredA.data.user.emailVerified, false);

  const verificationEmail = await waitForEmail("Bond402: E-Mail-Adresse bestätigen", verificationEmailIndex);
  const verificationToken = tokenFromEmail(verificationEmail, "/verify-email");

  const unverifiedLogin = await request("/api/auth/login", {
    body: { email: emailA, password: passwordA },
    headers: { "X-Forwarded-For": "203.0.113.10" },
  });
  assert.equal(unverifiedLogin.response.status, 403);
  assert.equal(unverifiedLogin.data.code, "EMAIL_NOT_VERIFIED");

  const verificationTokenHash = createHash("sha256").update(verificationToken, "utf8").digest("hex");
  assert.equal(
    runSql(`SELECT COUNT(*) FROM bond402_auth_tokens WHERE token_hash = '${verificationTokenHash}'`).trim(),
    "1",
  );
  runSql(`UPDATE bond402_auth_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = '${verificationTokenHash}'`);
  const expiredVerification = await request("/api/auth/verify-email", {
    body: { token: verificationToken },
  });
  assert.equal(expiredVerification.response.status, 400);
  assert.equal(expiredVerification.data.code, "INVALID_TOKEN");

  const resendStart = mockEmails.length;
  const resendVerification = await request("/api/auth/resend-verification", {
    body: { email: emailA },
  });
  const resendUnknown = await request("/api/auth/resend-verification", {
    body: { email: `${testPrefix}-unknown@example.test` },
  });
  assert.equal(resendVerification.response.status, 202);
  assert.equal(resendUnknown.response.status, 202);
  assert.deepEqual(resendVerification.data, resendUnknown.data);
  const resentVerificationEmail = await waitForEmail("Bond402: E-Mail-Adresse bestätigen", resendStart);
  const resentVerificationToken = tokenFromEmail(resentVerificationEmail, "/verify-email");
  const verified = await request("/api/auth/verify-email", {
    body: { token: resentVerificationToken },
  });
  assert.equal(verified.response.status, 200);
  const reusedVerification = await request("/api/auth/verify-email", {
    body: { token: resentVerificationToken },
  });
  assert.equal(reusedVerification.response.status, 400);
  assert.equal(reusedVerification.data.code, "INVALID_TOKEN");

  const verifiedLogin = await request("/api/auth/login", {
    jar: jarA,
    body: { email: emailA, password: passwordA },
  });
  assert.equal(verifiedLogin.response.status, 200);
  assert.ok(jarA.value);

  const registeredB = await request("/api/auth/register", {
    jar: jarB,
    body: { name: "Testkonto B", email: emailB, password: passwordB },
  });
  assert.equal(registeredB.response.status, 201);
  assert.equal(jarB.value, "");
  runSql(`UPDATE bond402_users SET email_verification_required = false WHERE email = '${emailB}'`);
  const existingAccountLogin = await request("/api/auth/login", {
    jar: jarB,
    body: { email: emailB, password: passwordB },
  });
  assert.equal(existingAccountLogin.response.status, 200);
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

  const forgotStart = mockEmails.length;
  const forgotPassword = await request("/api/auth/password/forgot", {
    body: { email: emailA },
    headers: { "X-Forwarded-For": "203.0.113.11" },
  });
  const forgotUnknown = await request("/api/auth/password/forgot", {
    body: { email: `${testPrefix}-not-registered@example.test` },
    headers: { "X-Forwarded-For": "203.0.113.11" },
  });
  assert.equal(forgotPassword.response.status, 202);
  assert.equal(forgotUnknown.response.status, 202);
  assert.deepEqual(forgotPassword.data, forgotUnknown.data);
  const resetEmail = await waitForEmail("Bond402: Passwort zurücksetzen", forgotStart);
  const resetToken = tokenFromEmail(resetEmail, "/reset-password");
  const invalidReset = await request("/api/auth/password/reset", {
    body: { token: "invalid-reset-token-invalid-reset-token", newPassword: "Reset-Public-123!" },
  });
  assert.equal(invalidReset.response.status, 400);
  assert.equal(invalidReset.data.code, "INVALID_TOKEN");
  const resetPassword = await request("/api/auth/password/reset", {
    body: { token: resetToken, newPassword: "Reset-Public-123!" },
  });
  assert.equal(resetPassword.response.status, 204);
  const reusedReset = await request("/api/auth/password/reset", {
    body: { token: resetToken, newPassword: "Reset-Public-456!" },
  });
  assert.equal(reusedReset.response.status, 400);
  assert.equal(reusedReset.data.code, "INVALID_TOKEN");
  const oldResetPasswordLogin = await request("/api/auth/login", {
    body: { email: emailA, password: "New-Public-Mvp-123!" },
    headers: { "X-Forwarded-For": "203.0.113.12" },
  });
  assert.equal(oldResetPasswordLogin.response.status, 401);
  const resetPasswordLogin = await request("/api/auth/login", {
    jar: jarA,
    body: { email: emailA, password: "Reset-Public-123!" },
    headers: { "X-Forwarded-For": "203.0.113.13" },
  });
  assert.equal(resetPasswordLogin.response.status, 200);

  const expiredResetStart = mockEmails.length;
  await request("/api/auth/password/forgot", {
    body: { email: emailA },
    headers: { "X-Forwarded-For": "203.0.113.14" },
  });
  const expiredResetEmail = await waitForEmail("Bond402: Passwort zurücksetzen", expiredResetStart);
  const expiredResetToken = tokenFromEmail(expiredResetEmail, "/reset-password");
  const expiredResetTokenHash = createHash("sha256").update(expiredResetToken, "utf8").digest("hex");
  runSql(`UPDATE bond402_auth_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = '${expiredResetTokenHash}'`);
  const expiredReset = await request("/api/auth/password/reset", {
    body: { token: expiredResetToken, newPassword: "Expired-Reset-123!" },
  });
  assert.equal(expiredReset.response.status, 400);
  assert.equal(expiredReset.data.code, "INVALID_TOKEN");

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

  const domainIssue = await request(`/api/services/${serviceId}/domain-verification`, {
    method: "POST",
    jar: jarA,
  });
  assert.equal(domainIssue.response.status, 200);
  assert.equal(domainIssue.data.status, "PENDING");
  assert.match(domainIssue.data.token, /^bond402_/);
  assert.equal(domainIssue.data.path, "/.well-known/bond402-verification.txt");

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

  const initialUsage = await request("/api/usage", { jar: jarA });
  assert.equal(initialUsage.response.status, 200);
  assert.equal(initialUsage.data.plan, "FREE");
  assert.equal(initialUsage.data.monthlyLimit, 100);
  assert.equal(initialUsage.data.usedChecks, 2);
  assert.equal(initialUsage.data.remainingChecks, 98);

  runSql(`
    UPDATE bond402_usage
    SET used_checks = 0, period_start = DATE_TRUNC('month', NOW())
    WHERE user_id = '${registeredA.data.user.id}';
    DELETE FROM bond402_api_checks
    WHERE service_id = '${serviceId}' AND check_type = 'LIVE';
  `);
  const checkSql = (status, reachable, responseTimeMs, structureMatch, errorCode = null) => `
    INSERT INTO bond402_api_checks
      (id, service_id, checked_at, status, check_type, reachable, response_time_ms,
       structure_match, http_status, error_code, summary, found_fields, missing_fields)
    VALUES
      ('${randomUUID()}', '${serviceId}', NOW(), '${status}', 'LIVE', ${reachable},
       ${responseTimeMs}, ${structureMatch}, ${reachable ? 200 : "NULL"},
       ${errorCode ? `'${errorCode}'` : "NULL"}, 'Testprüfung', '[]'::jsonb, '[]'::jsonb);
  `;
  runSql(checkSql("PASS", true, 120, true));
  const allowDecision = await request(`/api/developer/services/${serviceId}/pre-action-check`, {
    method: "POST",
    headers: { Authorization: `Bearer ${createdKey.data.secret}` },
  });
  assert.equal(allowDecision.response.status, 200);
  assert.equal(allowDecision.data.decision, "ALLOW");
  assert.equal(allowDecision.data.factors.latestReachable, true);
  assert.equal(allowDecision.data.factors.signals.tls, "NOT_EVALUATED");
  assert.equal(allowDecision.data.factors.trustMetrics.sampleCount, 1);

  runSql(checkSql("REVIEW", true, 120, true));
  const cautionDecision = await request(`/api/developer/services/${serviceId}/pre-action-check`, {
    method: "POST",
    headers: { Authorization: `Bearer ${createdKey.data.secret}` },
  });
  assert.equal(cautionDecision.response.status, 200);
  assert.equal(cautionDecision.data.decision, "CAUTION");
  assert.ok(cautionDecision.data.reasons.length > 0);

  runSql(checkSql("FAIL", false, 0, false, "TIMEOUT"));
  runSql(checkSql("FAIL", false, 0, false, "TIMEOUT"));
  const blockDecision = await request(`/api/developer/services/${serviceId}/pre-action-check`, {
    method: "POST",
    headers: { Authorization: `Bearer ${createdKey.data.secret}` },
  });
  assert.equal(blockDecision.response.status, 200);
  assert.equal(blockDecision.data.decision, "BLOCK");
  assert.ok(blockDecision.data.factors.anomalies.includes("REPEATED_FAILURES"));

  runSql(`
    UPDATE bond402_usage
    SET used_checks = 100, period_start = DATE_TRUNC('month', NOW())
    WHERE user_id = '${registeredA.data.user.id}';
  `);
  const quotaExceeded = await request(`/api/developer/services/${serviceId}/pre-action-check`, {
    method: "POST",
    headers: { Authorization: `Bearer ${createdKey.data.secret}` },
  });
  assert.equal(quotaExceeded.response.status, 429);
  assert.equal(quotaExceeded.data.code, "QUOTA_EXCEEDED");
  assert.equal(quotaExceeded.data.quota.remainingChecks, 0);

  runSql(`
    UPDATE bond402_usage
    SET period_start = DATE_TRUNC('month', NOW()) - INTERVAL '1 month'
    WHERE user_id = '${registeredA.data.user.id}';
  `);
  const resetUsage = await request("/api/usage", { jar: jarA });
  assert.equal(resetUsage.response.status, 200);
  assert.equal(resetUsage.data.usedChecks, 0);
  assert.equal(resetUsage.data.remainingChecks, 100);

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
    body: { email: emailA, password: "Reset-Public-123!" },
  });
  assert.equal(loggedInAgain.response.status, 200);
  const sessionHash = createHash("sha256").update(jarA.value, "utf8").digest("hex");
  runSql(`UPDATE bond402_sessions SET expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = '${sessionHash}'`);
  const expiredSession = await request("/api/auth/me", { jar: jarA });
  assert.equal(expiredSession.response.status, 401);
});