import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { once } from "node:events";
import https from "node:https";
import { randomUUID } from "node:crypto";
import { test, before, after } from "node:test";
import { encryptTargetSecret } from "../artifacts/api-server/src/lib/target-auth.ts";

const databaseUrl = process.env.DATABASE_URL;
const port = 18_128;
const baseUrl = `http://127.0.0.1:${port}`;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userEmail = `execution-${runId}@example.test`;
const userName = `Execution Agent ${runId}`;
const password = "Execution-Agent-Test-Password-402";
const providerHost = "example.com";
const serviceBase = `https://${providerHost}/bond402-execution-${runId}`;
const providerSecret = `provider-secret-${runId}`;
const previousHttpsRequest = https.request;
const previousFetch = globalThis.fetch;
const verificationEmails: Array<{ text?: string; html?: string }> = [];
const providerCalls: string[] = [];
let server: ReturnType<(typeof import("node:http"))["createServer"]>;
let app: typeof import("../artifacts/api-server/src/app")["default"];

class CookieJar {
  value = "";

  capture(response: Response) {
    const setCookie = response.headers.get("set-cookie");
    const match = setCookie?.match(/bond402_session=([^;]+)/);
    if (match) this.value = match[1];
  }

  header() {
    return this.value ? `bond402_session=${this.value}` : "";
  }
}

function sqlLiteral(value: string | null) {
  return value === null ? "NULL" : `'${value.replaceAll("'", "''")}'`;
}

function runSql(sql: string) {
  if (!databaseUrl) throw new Error("DATABASE_URL ist für den Execution-Gateway-Test erforderlich.");
  return execFileSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function cleanup() {
  runSql(`
    DELETE FROM bond402_execution_audit
    WHERE owner_id IN (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)});
    DELETE FROM bond402_execution_plans
    WHERE owner_id IN (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)});
    DELETE FROM bond402_sessions
    WHERE user_id IN (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)});
    DELETE FROM bond402_api_rate_limits
    WHERE identity IN (
      SELECT 'owner:' || id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)}
    )
    OR identity IN (
      SELECT 'key:' || id FROM bond402_api_keys
      WHERE owner_id IN (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)})
    );
    DELETE FROM bond402_api_keys
    WHERE owner_id IN (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)});
    DELETE FROM bond402_api_checks
    WHERE service_id IN (
      SELECT id FROM bond402_api_services
      WHERE owner_id IN (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)})
    );
    DELETE FROM bond402_api_services
    WHERE owner_id IN (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)});
    DELETE FROM bond402_usage
    WHERE user_id IN (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)});
    DELETE FROM bond402_auth_tokens
    WHERE user_id IN (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)});
    DELETE FROM bond402_users WHERE email = ${sqlLiteral(userEmail)};
  `);
}

async function request(path: string, options: RequestInit & { jar?: CookieJar; body?: unknown } = {}) {
  const { jar, body, headers = {}, ...fetchOptions } = options;
  const requestHeaders = new Headers(headers);
  if (jar?.header()) requestHeaders.set("Cookie", jar.header());
  if (body !== undefined) {
    requestHeaders.set("Content-Type", "application/json");
    fetchOptions.method ||= "POST";
    fetchOptions.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...fetchOptions,
    headers: requestHeaders,
  });
  jar?.capture(response);
  const text = await response.text();
  return { response, data: text ? JSON.parse(text) : null };
}

function responseForPath(path: string) {
  if (path.endsWith("/rate-limit")) {
    return { statusCode: 429, headers: { "content-type": "application/json", "retry-after": "7" }, body: JSON.stringify({ error: "slow down" }) };
  }
  if (path.endsWith("/server-error")) {
    return { statusCode: 503, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "provider unavailable" }) };
  }
  if (path.endsWith("/large")) {
    return { statusCode: 200, headers: { "content-type": "application/json" }, body: "x".repeat(1_000_001) };
  }
  if (path.endsWith("/redirect-private")) {
    return { statusCode: 302, headers: { location: "https://127.0.0.1/private" }, body: "" };
  }
  if (path.endsWith("/many")) {
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`field-${index}`, "x".repeat(1_000)]))),
    };
  }
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, token: providerSecret, note: providerSecret }),
  };
}

function installProviderFixture() {
  const httpsModule = https as typeof https & { request: typeof https.request };
  httpsModule.request = ((options: any, callback: (response: any) => void) => {
    if (options?.headers?.Host !== providerHost) return previousHttpsRequest(options, callback);
    const request = new EventEmitter() as EventEmitter & {
      end: () => void;
      destroy: (error?: Error) => void;
      setTimeout: () => void;
    };
    request.setTimeout = () => {};
    request.destroy = (error?: Error) => {
      if (error && !request.listenerCount("error")) return;
      if (error) process.nextTick(() => request.emit("error", error));
    };
    request.end = () => {
      providerCalls.push(options.path);
      if (options.path.endsWith("/timeout")) return;
      process.nextTick(() => {
        const fixture = responseForPath(options.path);
        const response = new EventEmitter() as EventEmitter & {
          statusCode: number;
          headers: Record<string, string>;
          socket: null;
          destroy: () => void;
        };
        response.statusCode = fixture.statusCode;
        response.headers = fixture.headers;
        response.socket = null;
        response.destroy = () => {};
        callback(response);
        if (fixture.body) response.emit("data", Buffer.from(fixture.body));
        response.emit("end");
      });
    };
    return request;
  }) as typeof https.request;
}

function securitySignals() {
  return {
    reachability: { status: "PASS", summary: "reachable" },
    transport: { status: "PASS", summary: "https", https: true, protocol: "TLS", certificateValid: true, expiresAt: null, daysRemaining: 100 },
    network: { status: "PASS", summary: "public" },
    redirects: { status: "PASS", summary: "none", count: 0, crossOrigin: false, downgraded: false },
    responseType: { status: "PASS", summary: "json", kind: "JSON", contentType: "application/json" },
    suspiciousPayload: { status: "PASS", summary: "clean", indicators: [] },
    securityHeaders: { status: "PASS", summary: "checked", evaluated: [], present: [], missing: [] },
    reputation: { status: "UNKNOWN", summary: "unknown" },
    rateLimit: { status: "PASS", summary: "none", detected: false, retryAfterSeconds: null },
    authentication: { status: "UNKNOWN", summary: "not required", required: false },
    securityConfidence: { status: "PASS", score: 95, summary: "strong enough for fixture" },
    threatIndicators: { status: "NONE_DETECTED", severity: "LOW", confidence: 1, indicators: [], summary: "clean" },
    historicalDrift: { status: "NONE", indicators: [], summary: "stable" },
  };
}

function createServiceSql(id: string, name: string, url: string, secretCiphertext: string | null = null, metadata: string | null = null) {
  const checks = Array.from({ length: 5 }, (_, index) => `
    INSERT INTO bond402_api_checks
      (id, service_id, status, check_type, reachable, response_time_ms, structure_match,
       http_status, error_code, summary, found_fields, missing_fields, https, tls_status,
       tls_days_remaining, security_headers, security_signals, probe_region, checked_at)
    VALUES
      (${sqlLiteral(randomUUID())}, ${sqlLiteral(id)}, 'PASS', 'LIVE', true, 10, true,
       200, NULL, 'fixture', '["ok"]'::jsonb, '[]'::jsonb, true, 'CHECKED',
       100, '{"status":"PASS","evaluated":[],"present":[],"missing":[]}'::jsonb,
       ${sqlLiteral(JSON.stringify(securitySignals()))}::jsonb, 'test', NOW() - INTERVAL '${index} minutes')
  `).join(";");
  return `
    INSERT INTO bond402_api_services
      (id, owner_id, name, url, auth_requirement, discovery_metadata, expected_structure,
       response_mode, max_response_time, visibility, request_method, target_auth_type,
       target_auth_secret_ciphertext, security_status)
    VALUES
      (${sqlLiteral(id)},
       (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)}),
       ${sqlLiteral(name)}, ${sqlLiteral(url)}, ${secretCiphertext ? "'REQUIRED'" : "'NOT_REQUIRED'"},
       ${metadata ? `${sqlLiteral(metadata)}::jsonb` : "NULL"}, 'ok', 'JSON', 100,
       'PRIVATE', 'GET', ${secretCiphertext ? "'BEARER'" : "'NONE'"},
       ${sqlLiteral(secretCiphertext)}, 'VERIFIED_LOW_RISK');
    ${checks};
  `;
}

before(async () => {
  if (!databaseUrl) throw new Error("DATABASE_URL ist für den Execution-Gateway-Test erforderlich.");
  cleanup();
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "execution-gateway-test-session-secret";
  process.env.RESEND_API_KEY = "execution-gateway-test-only";
  process.env.RESEND_API_URL = "https://execution-mail.example/send";
  process.env.PUBLIC_BASE_URL = "https://bond402.example";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === process.env.RESEND_API_URL) {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      verificationEmails.push(body);
      return new Response(JSON.stringify({ id: "execution-mail-fixture" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return previousFetch(input, init);
  }) as typeof fetch;
  installProviderFixture();
  ({ default: app } = await import("../artifacts/api-server/src/app"));
  server = app.listen(port);
  await once(server, "listening");
});

after(async () => {
  https.request = previousHttpsRequest;
  globalThis.fetch = previousFetch;
  if (server) {
    server.close();
    await once(server, "close").catch(() => {});
  }
  cleanup();
});

test("headless PLAN/EXECUTE enforces owner binding, outbound safety, feedback and audit", async () => {
  const onboarding = await request("/api/auth/register", { body: { name: userName, email: userEmail, password } });
  assert.equal(onboarding.response.status, 201);
  const emailText = verificationEmails.at(-1)?.text ?? "";
  const token = emailText.match(/\/verify-email\?token=([A-Za-z0-9_-]+)/)?.[1] ?? "";
  assert.ok(token);
  const verified = await request("/api/auth/verify-email", { body: { token } });
  assert.equal(verified.response.status, 200);
  const jar = new CookieJar();
  const login = await request("/api/auth/login", { jar, body: { email: userEmail, password } });
  assert.equal(login.response.status, 200);
  const key = await request("/api/api-keys", { jar, body: { name: `Execution Key ${runId}` } });
  assert.equal(key.response.status, 201);
  const secret = key.data.secret;
  const credentialCiphertext = encryptTargetSecret(providerSecret);

  const successId = randomUUID();
  const rateId = randomUUID();
  const serverId = randomUUID();
  const timeoutId = randomUUID();
  const largeId = randomUUID();
  const redirectId = randomUUID();
  const manyId = randomUUID();
  const parameterId = randomUUID();
  const missingCredentialId = randomUUID();
  const privateId = randomUUID();
  const metadata = JSON.stringify({
    execution: {
      operations: [{
        method: "GET",
        path: new URL(`${serviceBase}/parameter`).pathname,
        parameters: [{ name: "location", type: "string", required: true, location: "query" }],
      }],
    },
  });
  runSql(`
    UPDATE bond402_usage
    SET used_checks = 0
    WHERE user_id = (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)});
    ${createServiceSql(successId, "Execution Success", `${serviceBase}/success`, credentialCiphertext)}
    ${createServiceSql(rateId, "Rate Limit Provider", `${serviceBase}/rate-limit`)}
    ${createServiceSql(serverId, "Server Error Provider", `${serviceBase}/server-error`)}
    ${createServiceSql(timeoutId, "Timeout Provider", `${serviceBase}/timeout`)}
    ${createServiceSql(largeId, "Large Provider", `${serviceBase}/large`)}
    ${createServiceSql(redirectId, "Redirect Provider", `${serviceBase}/redirect-private`)}
    ${createServiceSql(manyId, "Many Field Provider", `${serviceBase}/many`)}
    ${createServiceSql(parameterId, "Parameter Provider", `${serviceBase}/parameter`, null, metadata)}
    ${createServiceSql(missingCredentialId, "Missing Credential Provider", `${serviceBase}/missing-credential`, null)}
    UPDATE bond402_api_services
    SET target_auth_type = 'BEARER', auth_requirement = 'REQUIRED'
    WHERE id = ${sqlLiteral(missingCredentialId)};
    ${createServiceSql(privateId, "Private Provider", "https://localhost/private")}
  `);

  async function plan(serviceId: string, parameters?: Record<string, unknown>) {
    return request("/api/developer/execution/plan", {
      body: { serviceId, parameters },
      headers: { Authorization: `Bearer ${secret}` },
    });
  }
  async function execute(planId: string, parameters?: Record<string, unknown>) {
    return request("/api/developer/execution/execute", {
      body: { planId, parameters },
      headers: { Authorization: `Bearer ${secret}` },
    });
  }

  const beforeSuccessCalls = providerCalls.length;
  const successPlan = await plan(successId);
  assert.equal(successPlan.response.status, 200);
  assert.equal(successPlan.data.status, "READY");
  assert.equal(successPlan.data.canExecute, true);
  assert.equal(successPlan.data.operation.method, "GET");
  assert.equal(successPlan.data.operation.path, `/bond402-execution-${runId}/success`);
  assert.equal(providerCalls.length, beforeSuccessCalls);
  const success = await execute(successPlan.data.planId, {});
  assert.equal(success.response.status, 200);
  assert.equal(success.data.status, "READY");
  assert.equal(success.data.code, "EXECUTION_COMPLETED");
  assert.equal(success.data.data.token, "[REDACTED]");
  assert.doesNotMatch(JSON.stringify(success.data), new RegExp(providerSecret));

  const replay = await execute(successPlan.data.planId, {});
  assert.equal(replay.data.status, "BLOCKED");
  assert.equal(replay.data.code, "EXECUTION_PLAN_EXPIRED");

  const unknownParameter = await plan(successId, { notRegistered: true });
  assert.equal(unknownParameter.data.status, "BLOCKED");
  assert.equal(unknownParameter.data.feedback.code, "PARAMETERS_NOT_DECLARED");
  const typedParameter = await plan(parameterId, { location: 42 });
  assert.equal(typedParameter.data.status, "BLOCKED");
  assert.equal(typedParameter.data.feedback.code, "PARAMETER_SCHEMA_INVALID");

  const secondKey = await request("/api/api-keys", { jar, body: { name: `Execution Key 2 ${runId}` } });
  assert.equal(secondKey.response.status, 201);
  const crossKey = await request("/api/developer/execution/execute", {
    body: { planId: successPlan.data.planId, parameters: {} },
    headers: { Authorization: `Bearer ${secondKey.data.secret}` },
  });
  assert.equal(crossKey.response.status, 404);

  const driftPlan = await plan(rateId);
  runSql(`UPDATE bond402_api_services SET url = ${sqlLiteral(`${serviceBase}/server-error`)} WHERE id = ${sqlLiteral(rateId)}`);
  const drift = await execute(driftPlan.data.planId, {});
  assert.equal(drift.data.status, "BLOCKED");
  assert.equal(drift.data.code, "EXECUTION_CONFIGURATION_CHANGED");
  runSql(`UPDATE bond402_api_services SET url = ${sqlLiteral(`${serviceBase}/rate-limit`)} WHERE id = ${sqlLiteral(rateId)}`);

  const concurrentPlan = await plan(successId);
  const callsBeforeConcurrent = providerCalls.length;
  const concurrent = await Promise.all([
    execute(concurrentPlan.data.planId, {}),
    execute(concurrentPlan.data.planId, {}),
  ]);
  assert.equal(concurrent.filter((response) => response.data.status === "READY").length, 1);
  assert.equal(concurrent.filter((response) => ["EXECUTION_PLAN_ALREADY_USED", "EXECUTION_PLAN_EXPIRED"].includes(response.data.code)).length, 1);
  assert.equal(providerCalls.length, callsBeforeConcurrent + 1);
  const usedAfterConcurrent = Number(runSql(`
    SELECT used_checks FROM bond402_usage
    WHERE user_id = (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)})
  `).trim());
  assert.equal(usedAfterConcurrent, 2);
  runSql(`
    DELETE FROM bond402_api_rate_limits
    WHERE identity IN (
      'owner:' || (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)}),
      'key:' || (SELECT id FROM bond402_api_keys WHERE owner_id = (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)}) ORDER BY created_at LIMIT 1)
    );
  `);

  const missingParameter = await plan(parameterId);
  assert.equal(missingParameter.data.status, "PARAMETER_REQUIRED");
  assert.deepEqual(missingParameter.data.requiredParameters, ["location"]);
  assert.equal(providerCalls.length, beforeSuccessCalls + 2);

  const missingCredential = await plan(missingCredentialId);
  assert.equal(missingCredential.data.status, "AUTH_REQUIRED");
  assert.equal(providerCalls.length, beforeSuccessCalls + 2);

  const external = await request("/api/developer/execution/plan", {
    body: { serviceId: "external:fixture-unverified" },
    headers: { Authorization: `Bearer ${secret}` },
  });
  assert.equal(external.data.status, "UNVERIFIED_EXTERNAL");
  assert.equal(providerCalls.length, beforeSuccessCalls + 2);

  const privatePlan = await plan(privateId);
  assert.equal(privatePlan.data.status, "BLOCKED");
  assert.equal(privatePlan.data.feedback.code, "PRIVATE_ADDRESS");
  assert.equal(providerCalls.length, beforeSuccessCalls + 2);

  const redirectPlan = await plan(redirectId);
  assert.equal(redirectPlan.data.status, "READY");
  const redirect = await execute(redirectPlan.data.planId, {});
  assert.equal(redirect.data.status, "BLOCKED");
  assert.equal(redirect.data.code, "PRIVATE_ADDRESS");

  for (const [id, expectedStatus] of [
    [rateId, "RATE_LIMITED"],
    [serverId, "PROVIDER_ERROR"],
    [largeId, "PROVIDER_ERROR"],
  ] as const) {
    const providerPlan = await plan(id);
    assert.equal(providerPlan.data.status, "READY");
    const response = await execute(providerPlan.data.planId, {});
    assert.equal(response.data.status, expectedStatus);
  }
  const timeoutPlan = await plan(timeoutId);
  const timeout = await execute(timeoutPlan.data.planId, {});
  assert.equal(timeout.data.status, "PROVIDER_ERROR");
  assert.equal(timeout.data.retryable, true);
  const manyPlan = await plan(manyId);
  const many = await execute(manyPlan.data.planId, {});
  assert.equal(many.data.status, "READY");
  assert.ok(Buffer.byteLength(JSON.stringify(many.data.data), "utf8") < 80_000);

  runSql(`
    UPDATE bond402_usage
    SET used_checks = 100
    WHERE user_id = (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)});
  `);
  const quotaPlan = await plan(successId);
  assert.equal(quotaPlan.data.status, "READY");
  const quota = await execute(quotaPlan.data.planId, {});
  assert.equal(quota.response.status, 429);
  assert.equal(quota.data.status, "PAYMENT_REQUIRED");
  assert.equal(quota.data.code, "QUOTA_EXCEEDED");

  const audit = runSql(`
    SELECT status || '|' || code || '|' || COALESCE(output_digest, '')
    FROM bond402_execution_audit
    WHERE owner_id = (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)})
    ORDER BY created_at
  `);
  assert.match(audit, /READY\\|EXECUTION_COMPLETED/);
  assert.match(audit, /RATE_LIMITED\\|PROVIDER_RATE_LIMITED/);
  assert.match(audit, /PROVIDER_ERROR\\|PROVIDER_5XX/);
  assert.match(audit, /BLOCKED\\|EXECUTION_PLAN_EXPIRED/);
  assert.match(audit, /BLOCKED\\|EXECUTION_CONFIGURATION_CHANGED/);
  assert.doesNotMatch(audit, new RegExp(providerSecret));
});