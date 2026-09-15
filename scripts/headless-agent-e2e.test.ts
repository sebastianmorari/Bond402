import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { once } from "node:events";
import https from "node:https";
import { test, before, after } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
const port = 18_127;
const baseUrl = `http://127.0.0.1:${port}`;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userEmail = `headless-${runId}@example.test`;
const userName = `Headless Agent ${runId}`;
const password = "Headless-Agent-Test-Password-402";
const directApiUrl = "https://example.com";
const mailUrl = "https://headless-mail.example/emails";
const liveServiceUrl = `https://example.com/bond402-headless-${runId}`;

const previousFetch = globalThis.fetch;
const previousHttpsRequest = https.request;
const verificationEmails: Array<{ text?: string; html?: string }> = [];
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

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function runSql(sql: string) {
  if (!databaseUrl) throw new Error("DATABASE_URL ist für den headless Agent-Test erforderlich.");
  return execFileSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function cleanup() {
  runSql(`
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
    DELETE FROM bond402_api_services
    WHERE owner_id IN (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)});
    DELETE FROM bond402_usage
    WHERE user_id IN (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)});
    DELETE FROM bond402_auth_tokens
    WHERE user_id IN (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)});
    DELETE FROM bond402_users WHERE email = ${sqlLiteral(userEmail)};
  `);
}

function openApiDocument() {
  return {
    openapi: "3.0.3",
    info: { title: "Headless Agent Fixture", description: "Safe test API" },
    servers: [{ url: directApiUrl }],
    paths: {
      "/status": {
        get: {
          operationId: "getStatus",
          summary: "Public status",
          security: [],
          responses: { "200": { description: "OK" } },
        },
      },
    },
  };
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
  const response = await previousFetch(`${baseUrl}${path}`, {
    ...fetchOptions,
    headers: requestHeaders,
  });
  jar?.capture(response);
  const text = await response.text();
  return { response, data: text ? JSON.parse(text) : null };
}

before(async () => {
  if (!databaseUrl) throw new Error("DATABASE_URL ist für den headless Agent-Test erforderlich.");
  cleanup();
  process.env.NODE_ENV = "test";
  process.env.RESEND_API_KEY = "headless-agent-test-only";
  process.env.RESEND_API_URL = mailUrl;
  process.env.PUBLIC_BASE_URL = "https://bond402.example";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === mailUrl) {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      verificationEmails.push(body);
      return new Response(JSON.stringify({ id: "headless-mail-fixture" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === `${directApiUrl}/openapi.json`) {
      return new Response(JSON.stringify(openApiDocument()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.startsWith(directApiUrl)) {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return previousFetch(input, init);
  }) as typeof fetch;

  const httpsModule = https as typeof https & { request: typeof https.request };
  httpsModule.request = ((options: any, callback: (response: any) => void) => {
    if (options?.headers?.Host !== "example.com") {
      return previousHttpsRequest(options, callback);
    }

    const request = new EventEmitter() as EventEmitter & {
      end: (body?: string) => void;
      destroy: (error?: Error) => void;
      setTimeout: () => void;
    };
    request.setTimeout = () => {};
    request.destroy = (error?: Error) => {
      if (error) process.nextTick(() => request.emit("error", error));
    };
    request.end = () => {
      process.nextTick(() => {
        const response = new EventEmitter() as EventEmitter & {
          statusCode: number;
          headers: Record<string, string>;
          socket: null;
          destroy: () => void;
        };
        response.statusCode = 200;
        response.headers = { "content-type": "application/json" };
        response.socket = null;
        response.destroy = () => {};
        callback(response);
        const body = options.path === "/openapi.json"
          ? JSON.stringify(openApiDocument())
          : JSON.stringify({ status: "ok" });
        response.emit("data", Buffer.from(body));
        response.emit("end");
      });
    };
    return request;
  }) as typeof https.request;

  ({ default: app } = await import("../artifacts/api-server/src/app"));
  server = app.listen(port);
  await once(server, "listening");
});

after(async () => {
  globalThis.fetch = previousFetch;
  https.request = previousHttpsRequest;
  if (server) {
    server.close();
    await once(server, "close").catch(() => {});
  }
  cleanup();
});

test("vollständiger headless Agent- und Developer-Onboarding-Flow", async () => {
  const onboarding = await request("/api/public/agent-onboarding");
  assert.equal(onboarding.response.status, 200);
  assert.equal(onboarding.data.feedback.contractVersion, "2026-09-14");
  assert.deepEqual(
    onboarding.data.steps.filter((step: { visibility: string }) => step.visibility === "PUBLIC").map((step: { id: string }) => step.id),
    ["public-discovery", "agent-decision", "direct-openapi-discovery", "public-detail", "public-pre-action", "safe-external-check"],
  );
  assert.ok(onboarding.data.steps.some((step: { id: string; authentication: string }) =>
    step.id === "owner-service-registration" && step.authentication === "BOND402_SESSION_COOKIE"));
  assert.ok(onboarding.data.steps.some((step: { id: string; authentication: string }) =>
    step.id === "developer-live-check" && step.authentication === "BOND402_API_KEY"));

  const direct = await request("/api/public/discovery/openapi", {
    body: { url: directApiUrl },
  });
  assert.equal(direct.response.status, 200);
  assert.equal(direct.data.feedback.status, "UNVERIFIED_EXTERNAL");
  assert.equal(direct.data.verification.status, "UNVERIFIED_EXTERNAL");
  assert.equal(direct.data.safeEndpoint.path, "/status");
  const externalId = direct.data.id;

  const detail = await request(`/api/public/services/${encodeURIComponent(externalId)}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.data.feedback.status, "UNVERIFIED_EXTERNAL");
  assert.equal(detail.data.source.specificationUrl, `${directApiUrl}/openapi.json`);

  const preflight = await request(`/api/public/services/${encodeURIComponent(externalId)}/external-preflight`, {
    body: {},
  });
  assert.equal(preflight.response.status, 200);
  assert.equal(preflight.data.feedback.status, "UNVERIFIED_EXTERNAL");
  assert.equal(preflight.data.verification.persisted, false);

  const registration = await request("/api/auth/register", {
    body: { name: userName, email: userEmail, password },
  });
  assert.equal(registration.response.status, 201);
  assert.equal(registration.data.feedback.status, "READY");
  assert.equal(registration.data.feedback.code, "OWNER_REGISTRATION_CREATED");
  const emailText = verificationEmails.at(-1)?.text ?? "";
  const token = emailText.match(/\/verify-email\?token=([A-Za-z0-9_-]+)/)?.[1];
  assert.ok(token, "Die Bestätigungs-E-Mail muss den einmaligen Token enthalten.");

  const verified = await request("/api/auth/verify-email", {
    body: { token },
  });
  assert.equal(verified.response.status, 200);
  assert.equal(verified.data.feedback.status, "READY");

  const jar = new CookieJar();
  const login = await request("/api/auth/login", {
    jar,
    body: { email: userEmail, password },
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.data.feedback.code, "OWNER_SESSION_READY");
  assert.ok(jar.value);

  const service = await request("/api/services", {
    jar,
    body: {
      name: `Headless Service ${runId}`,
      url: liveServiceUrl,
      expectedStructure: "status",
      responseMode: "JSON",
      maxResponseTime: 2_000,
      domainRelationship: "THIRD_PARTY",
    },
  });
  assert.equal(service.response.status, 201);
  assert.equal(service.data.feedback.status, "READY");
  assert.equal(service.data.feedback.context.serviceId, service.data.id);
  const serviceId = service.data.id;

  runSql(`
    UPDATE bond402_api_services
    SET visibility = 'LISTED', security_status = 'VERIFIED_LOW_RISK'
    WHERE id = ${sqlLiteral(serviceId)}
      AND owner_id = (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)});
  `);

  const publicPreAction = await request(`/api/public/services/${encodeURIComponent(serviceId)}/pre-action-check`);
  assert.equal(publicPreAction.response.status, 200);
  assert.equal(publicPreAction.data.feedback.status, "BLOCKED");
  assert.equal(publicPreAction.data.access.requiresDeveloperKey, false);

  const decision = await request("/api/public/agent/decision", {
    body: { task: `Headless Service ${runId}` },
  });
  assert.equal(decision.response.status, 200);
  for (const field of [
    "contractVersion",
    "intent",
    "bestCandidate",
    "why",
    "authRequirement",
    "requiredParameters",
    "verificationStatus",
    "canExecute",
    "blockers",
    "nextAction",
    "provenance",
    "feedback",
  ]) {
    assert.ok(field in decision.data, `Decision-Feld ${field} fehlt.`);
  }
  assert.equal(decision.data.intent.capability, "UNKNOWN");
  assert.equal(decision.data.bestCandidate.id, serviceId, JSON.stringify(decision.data.candidates));
  assert.equal(decision.data.bestCandidate.kind, "INTERNAL_SERVICE");
  assert.equal(decision.data.canExecute, false);
  assert.ok(decision.data.blockers.includes("NO_KNOWN_SAFE_OPERATION"));
  assert.equal(decision.data.provenance.externalCandidatesAlwaysUnverified, true);
  assert.equal(decision.data.feedback.status, "BLOCKED");

  const missingKey = await request(`/api/developer/services/${encodeURIComponent(serviceId)}/checks`, {
    method: "POST",
  });
  assert.equal(missingKey.response.status, 401);
  assert.equal(missingKey.data.feedback.status, "AUTH_REQUIRED");

  const key = await request("/api/api-keys", {
    jar,
    body: { name: `Headless Key ${runId}` },
  });
  assert.equal(key.response.status, 201);
  assert.equal(key.data.feedback.status, "READY");
  assert.match(key.data.secret, /^b402_[A-Za-z0-9_-]+$/);

  const liveCheck = await request(`/api/developer/services/${encodeURIComponent(serviceId)}/checks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key.data.secret}` },
  });
  assert.equal(liveCheck.response.status, 201);
  assert.equal(liveCheck.data.feedback.status, "READY");
  assert.equal(liveCheck.data.feedback.code, "LIVE_CHECK_COMPLETED");
  assert.ok(liveCheck.data.latestCheck);

  const usage = runSql(`
    SELECT user_id FROM bond402_usage
    WHERE user_id = (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)});
  `).trim();
  assert.equal(usage.length > 0, true);
  runSql(`
    UPDATE bond402_usage
    SET used_checks = 100
    WHERE user_id = (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(userEmail)});
  `);

  const exhausted = await request(`/api/developer/services/${encodeURIComponent(serviceId)}/pre-action-check`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key.data.secret}` },
    body: { actionContext: "READ" },
  });
  assert.equal(exhausted.response.status, 429);
  assert.equal(exhausted.data.feedback.status, "PAYMENT_REQUIRED");
});