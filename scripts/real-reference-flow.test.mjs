import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";

const enabled = process.env.BOND402_REAL_REFERENCE_TEST === "1";
const databaseUrl = process.env.DATABASE_URL;
const port = Number(process.env.BOND402_REAL_REFERENCE_PORT || 18131);
const baseUrl = `http://127.0.0.1:${port}`;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const email = `real-reference-${runId}@example.test`;
const referenceUrl = "https://httpbin.dev/get";

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

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runSql(sql) {
  if (!databaseUrl) throw new Error("DATABASE_URL ist für den Realtest erforderlich.");
  return execFileSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-At"], {
    encoding: "utf8",
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function cleanup() {
  if (!databaseUrl) return;
  runSql(`
    DELETE FROM bond402_execution_audit
    WHERE owner_id IN (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(email)});
    DELETE FROM bond402_execution_plans
    WHERE owner_id IN (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(email)});
    DELETE FROM bond402_sessions
    WHERE user_id IN (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(email)});
    DELETE FROM bond402_api_rate_limits
    WHERE identity IN (
      SELECT 'owner:' || id FROM bond402_users WHERE email = ${sqlLiteral(email)}
    )
    OR identity IN (
      SELECT 'key:' || id FROM bond402_api_keys
      WHERE owner_id IN (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(email)})
    );
    DELETE FROM bond402_api_keys
    WHERE owner_id IN (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(email)});
    DELETE FROM bond402_api_checks
    WHERE service_id IN (
      SELECT id FROM bond402_api_services
      WHERE owner_id IN (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(email)})
    );
    DELETE FROM bond402_api_services
    WHERE owner_id IN (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(email)});
    DELETE FROM bond402_usage
    WHERE user_id IN (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(email)});
    DELETE FROM bond402_auth_tokens
    WHERE user_id IN (SELECT id FROM bond402_users WHERE email = ${sqlLiteral(email)});
    DELETE FROM bond402_users WHERE email = ${sqlLiteral(email)};
  `);
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
  return { response, data: text ? JSON.parse(text) : null };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/healthz`);
      if (response.ok) return;
    } catch {
      // The child process may still be compiling or binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Der Realtest-API-Server wurde nicht rechtzeitig erreichbar.");
}

if (!enabled) {
  test("opt-in: realer externer Owner-Flow", { skip: "Setze BOND402_REAL_REFERENCE_TEST=1." }, () => {});
} else {
  test("owner-gebundener Flow gegen den kostenlosen HTTPS-No-Auth-Referenzdienst", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL ist für den opt-in Realtest erforderlich.");
    }

    cleanup();
    const emails = [];
    const emailServer = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        emails.push(JSON.parse(body));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "real-reference-test-email" }));
      });
    });
    emailServer.listen(port + 1, "127.0.0.1");
    await once(emailServer, "listening");

    const server = spawn("node", ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"], {
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(port),
        RESEND_API_KEY: "real-reference-test-key",
        RESEND_API_URL: `http://127.0.0.1:${port + 1}/emails`,
        PUBLIC_BASE_URL: baseUrl,
        RESEND_FROM_EMAIL: "onboarding@resend.dev",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stderr.on("data", (chunk) => process.stderr.write(`[real-reference-api] ${chunk}`));

    try {
      await waitForServer();
      const jar = new CookieJar();
      const registration = await request("/api/auth/register", {
        jar,
        body: {
          name: `HTTPBin Owner ${runId}`,
          email,
          password: "Real-Reference-Flow-Password-402!",
        },
      });
      assert.equal(registration.response.status, 201);
      const mail = emails.at(-1);
      assert.ok(mail?.text);
      const token = mail.text.match(/\/verify-email\?token=([A-Za-z0-9_-]+)/)?.[1];
      assert.ok(token);

      const verification = await request("/api/auth/verify-email", { body: { token } });
      assert.equal(verification.response.status, 200);
      const login = await request("/api/auth/login", {
        jar,
        body: {
          email,
          password: "Real-Reference-Flow-Password-402!",
        },
      });
      assert.equal(login.response.status, 200);

      const usageBefore = await request("/api/usage", { jar });
      assert.equal(usageBefore.response.status, 200);
      const metadata = {
        openapi: "3.0.3",
        info: { title: "Free HTTP reference", version: "1.0.0" },
        execution: {
          operations: [{
            method: "GET",
            path: "/get",
            parameters: [{
              name: "bond402_probe",
              type: "string",
              required: true,
              location: "query",
            }],
          }],
        },
      };
      const registered = await request("/api/services", {
        jar,
        body: {
          name: "HTTPBin public GET reference",
          url: referenceUrl,
          sourceType: "EXTERNAL_DISCOVERY",
          sourceProvider: "httpbin",
          sourceUrl: referenceUrl,
          authRequirement: "NOT_REQUIRED",
          discoveryMetadata: metadata,
          expectedStructure: "args, headers, origin, url",
          responseMode: "JSON",
          maxResponseTime: 10_000,
          requestMethod: "GET",
          targetAuthType: "NONE",
          domainRelationship: "THIRD_PARTY",
        },
      });
      assert.equal(registered.response.status, 201);
      assert.equal(registered.data.securityStatus, "SANDBOX_PENDING");
      assert.equal(registered.data.targetAuthSecretConfigured, false);
      assert.equal("ownerId" in registered.data, false);
      const serviceId = registered.data.id;

      for (let index = 0; index < 3; index += 1) {
        const check = await request(`/api/services/${serviceId}/checks`, { jar, method: "POST" });
        assert.equal(check.response.status, 201, JSON.stringify(check.data));
        assert.equal(check.data.httpStatus, 200);
        assert.equal(check.data.classification, "SUCCESS");
        assert.equal(check.data.reachable, true);
      }

      const ownerService = await request(`/api/services/${serviceId}`, { jar });
      assert.equal(ownerService.response.status, 200);
      assert.equal(ownerService.data.securityStatus, "VERIFIED_LOW_RISK");
      assert.deepEqual(
        ownerService.data.discoveryMetadata.execution.operations[0],
        metadata.execution.operations[0],
      );

      const key = await request("/api/api-keys", {
        jar,
        body: { name: `Real reference execution key ${runId}` },
      });
      assert.equal(key.response.status, 201);
      const authorization = { Authorization: `Bearer ${key.data.secret}` };

      const plan = await request("/api/developer/execution/plan", {
        headers: authorization,
        body: {
          task: "HTTPBin public GET reference",
          parameters: { bond402_probe: `owner-flow-${runId}` },
        },
      });
      assert.equal(plan.response.status, 200, JSON.stringify(plan.data));
      assert.equal(plan.data.status, "READY", JSON.stringify(plan.data));
      assert.equal(plan.data.operation.method, "GET");
      assert.equal(plan.data.operation.path, "/get");
      assert.equal(plan.data.parameters.bond402_probe, `owner-flow-${runId}`);

      const execution = await request("/api/developer/execution/execute", {
        headers: authorization,
        body: {
          planId: plan.data.planId,
          parameters: { bond402_probe: `owner-flow-${runId}` },
        },
      });
      assert.equal(execution.response.status, 200, JSON.stringify(execution.data));
      assert.equal(execution.data.status, "READY");
      assert.equal(execution.data.code, "EXECUTION_COMPLETED");
      assert.equal(execution.data.providerHttpStatus, 200);
      assert.deepEqual(execution.data.data.args.bond402_probe, [`owner-flow-${runId}`]);
      assert.match(execution.data.data.url, /bond402_probe=owner-flow-/);
      assert.equal(execution.data.retryable, false);

      const audit = runSql(`
        SELECT status, code, provider_http_status, quota_used,
               (parameters_digest IS NOT NULL)::text
        FROM bond402_execution_audit
        WHERE request_id = ${sqlLiteral(execution.data.requestId)}
      `).trim().split("|");
      assert.deepEqual(audit, ["READY", "EXECUTION_COMPLETED", "200", "4", "true"]);

      const usageAfter = await request("/api/usage", { jar });
      assert.equal(usageAfter.response.status, 200);
      assert.equal(
        usageAfter.data.usedChecks,
        usageBefore.data.usedChecks + 4,
        "drei Live-Checks plus eine Ausführung müssen genau vier Free-Quota-Einheiten verbrauchen",
      );
      console.log(JSON.stringify({
        referenceUrl,
        status: ownerService.data.securityStatus,
        providerHttpStatus: execution.data.providerHttpStatus,
        usageUnits: 4,
      }));
    } finally {
      if (!server.killed) {
        server.kill("SIGTERM");
        await once(server, "exit").catch(() => {});
      }
      emailServer.close();
      await once(emailServer, "close").catch(() => {});
      cleanup();
    }
  });
}