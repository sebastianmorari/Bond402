import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { test, before, after } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
const port = Number(process.env.BOND402_OAUTH_TEST_PORT || 18129);
const baseUrl = `http://127.0.0.1:${port}`;
const testId = randomUUID();
const userId = `oauth-test-user-${testId}`;
const email = `${testId}@oauth.test`;
const sessionToken = randomBytes(32).toString("base64url");
const sessionHash = createHash("sha256").update(sessionToken, "utf8").digest("hex");
const redirectUri = `https://oauth-client-${testId}.example/callback`;
let server;
let clientId;

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runSql(sql) {
  if (!databaseUrl) throw new Error("DATABASE_URL ist für die OAuth-Tests erforderlich.");
  return execFileSync(
    "psql",
    [databaseUrl, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function cleanup() {
  if (!databaseUrl) return;
  runSql(`
    DELETE FROM bond402_oauth_access_tokens WHERE owner_id = ${sqlLiteral(userId)};
    DELETE FROM bond402_oauth_refresh_tokens WHERE owner_id = ${sqlLiteral(userId)};
    DELETE FROM bond402_oauth_authorization_codes WHERE owner_id = ${sqlLiteral(userId)};
    ${clientId ? `DELETE FROM bond402_oauth_clients WHERE client_id = ${sqlLiteral(clientId)};` : ""}
    DELETE FROM bond402_sessions WHERE user_id = ${sqlLiteral(userId)};
    DELETE FROM bond402_users WHERE id = ${sqlLiteral(userId)};
  `);
}

async function request(path, options = {}) {
  const {
    body,
    form = false,
    authenticated = false,
    redirect = "follow",
    ...fetchOptions
  } = options;
  const headers = {
    ...(body === undefined ? {} : {
      "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json",
    }),
    ...(authenticated ? { Cookie: `bond402_session=${sessionToken}` } : {}),
    ...(fetchOptions.headers || {}),
  };
  const response = await fetch(`${baseUrl}${path}`, {
    ...fetchOptions,
    headers,
    redirect,
    body: body === undefined
      ? undefined
      : form
        ? new URLSearchParams(body)
        : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { response, data, text };
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  return { verifier, challenge };
}

function hiddenValue(html, name) {
  const match = html.match(new RegExp(`<input type="hidden" name="${name}" value="([^"]+)"`));
  return match?.[1] ?? null;
}

function mcpHeaders(accessToken) {
  return {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    "MCP-Protocol-Version": "2026-07-28",
    "MCP-Method": "tools/list",
  };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/healthz`);
      if (response.ok) return;
    } catch {
      // The child process may still be compiling or binding.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Der OAuth-Test-API-Server wurde nicht rechtzeitig erreichbar.");
}

before(async () => {
  if (!databaseUrl) throw new Error("DATABASE_URL ist für die OAuth-Tests erforderlich.");
  server = spawn("node", ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"], {
    env: { ...process.env, NODE_ENV: "test", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (chunk) => process.stderr.write(`[oauth-api] ${chunk}`));
  await waitForServer();
  assert.deepEqual(
    runSql(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name LIKE 'bond402_oauth_%'
      ORDER BY table_name
    `).trim().split("\n"),
    [
      "bond402_oauth_access_tokens",
      "bond402_oauth_authorization_codes",
      "bond402_oauth_authorization_requests",
      "bond402_oauth_clients",
      "bond402_oauth_refresh_tokens",
    ],
  );
  cleanup();
  runSql(`
    INSERT INTO bond402_users (id, email, display_name, password_hash, email_verification_required)
    VALUES (${sqlLiteral(userId)}, ${sqlLiteral(email)}, 'OAuth Routentest', 'test-only', false);
    INSERT INTO bond402_sessions (id, user_id, token_hash, expires_at)
    VALUES (${sqlLiteral(randomUUID())}, ${sqlLiteral(userId)}, ${sqlLiteral(sessionHash)}, NOW() + INTERVAL '1 hour');
  `);
});

after(async () => {
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await once(server, "exit").catch(() => {});
  }
  cleanup();
});

test("OAuth metadata and safe dynamic client registration are exposed", async () => {
  const resource = await request("/.well-known/oauth-protected-resource");
  assert.equal(resource.response.status, 200);
  assert.equal(resource.data.resource, `${baseUrl}/mcp`);
  assert.deepEqual(resource.data.bearer_methods_supported, ["header"]);
  assert.ok(resource.data.authorization_servers.includes(baseUrl));

  const authorizationServer = await request("/.well-known/oauth-authorization-server");
  assert.equal(authorizationServer.response.status, 200);
  assert.equal(authorizationServer.data.authorization_endpoint, `${baseUrl}/oauth/authorize`);
  assert.deepEqual(authorizationServer.data.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(authorizationServer.data.token_endpoint_auth_methods_supported, ["none"]);
  assert.ok(authorizationServer.data.scopes_supported.includes("offline_access"));

  const rejected = await request("/oauth/register", {
    method: "POST",
    body: {
      client_name: "unsafe",
      redirect_uris: ["https://client.example/callback#fragment"],
    },
  });
  assert.equal(rejected.response.status, 400);
  assert.equal(rejected.data.error, "invalid_client_metadata");

  const registered = await request("/oauth/register", {
    method: "POST",
    body: {
      client_name: "Deterministischer OAuth-Test",
      client_uri: "https://chat.openai.com",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "read plan execute audit offline_access",
    },
  });
  assert.equal(registered.response.status, 201, registered.text);
  clientId = registered.data.client_id;
  assert.match(clientId, /^b402_client_/);
  assert.equal(registered.data.client_secret, undefined);
});

test("OAuth PKCE authorization, replay protection, scope visibility, rotation and revocation work", async () => {
  assert.ok(clientId, "client registration must run first");
  const { verifier, challenge } = pkce();
  const state = `state-${randomUUID()}`;
  const resource = `${baseUrl}/mcp`;
  const authorize = new URL("/oauth/authorize", baseUrl);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read plan execute audit offline_access",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
  }).toString();

  const invalidRedirect = await request(`${authorize.pathname}?${new URLSearchParams({
    ...Object.fromEntries(authorize.searchParams),
    redirect_uri: "https://attacker.example/callback",
  })}`, { authenticated: true, redirect: "manual" });
  assert.equal(invalidRedirect.response.status, 400);

  const missingState = await request(`${authorize.pathname}?${new URLSearchParams({
    ...Object.fromEntries(authorize.searchParams),
    state: "",
  })}`, { authenticated: true, redirect: "manual" });
  assert.equal(missingState.response.status, 400);

  const invalidResource = await request(`${authorize.pathname}?${new URLSearchParams({
    ...Object.fromEntries(authorize.searchParams),
    resource: `${baseUrl}/other-resource`,
  })}`, { authenticated: true, redirect: "manual" });
  assert.equal(invalidResource.response.status, 400);

  const consent = await request(`${authorize.pathname}${authorize.search}`, {
    authenticated: true,
    redirect: "manual",
  });
  assert.equal(consent.response.status, 200);
  const transaction = hiddenValue(consent.text, "transaction");
  const csrfToken = hiddenValue(consent.text, "csrf_token");
  assert.ok(transaction);
  assert.ok(csrfToken);

  const forgedDecision = await request("/oauth/authorize/decision", {
    method: "POST",
    authenticated: true,
    form: true,
    redirect: "manual",
    body: { transaction, csrf_token: "forged", decision: "approve" },
  });
  assert.equal(forgedDecision.response.status, 400);

  const decision = await request("/oauth/authorize/decision", {
    method: "POST",
    authenticated: true,
    form: true,
    redirect: "manual",
    body: {
      transaction,
      csrf_token: csrfToken,
      decision: "approve",
    },
  });
  assert.equal(decision.response.status, 302);
  const callback = new URL(decision.response.headers.get("location"));
  assert.equal(callback.searchParams.get("state"), state);
  const code = callback.searchParams.get("code");
  assert.ok(code);

  const invalidVerifier = await request("/oauth/token", {
    method: "POST",
    form: true,
    body: {
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: randomBytes(32).toString("base64url"),
      resource,
    },
  });
  assert.equal(invalidVerifier.response.status, 400);
  assert.equal(invalidVerifier.data.error, "invalid_grant");

  const exchanged = await request("/oauth/token", {
    method: "POST",
    form: true,
    body: {
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource,
    },
  });
  assert.equal(exchanged.response.status, 200, exchanged.text);
  assert.equal(exchanged.data.token_type, "Bearer");
  assert.ok(exchanged.data.access_token);
  assert.ok(exchanged.data.refresh_token);

  const wrongRefreshResource = await request("/oauth/token", {
    method: "POST",
    form: true,
    body: {
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: exchanged.data.refresh_token,
      resource: `${baseUrl}/other-resource`,
    },
  });
  assert.equal(wrongRefreshResource.response.status, 400);

  const replay = await request("/oauth/token", {
    method: "POST",
    form: true,
    body: {
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource,
    },
  });
  assert.equal(replay.response.status, 400);
  assert.equal(replay.data.error, "invalid_grant");

  const listed = await request("/mcp", {
    method: "POST",
    headers: mcpHeaders(exchanged.data.access_token),
    body: {
      jsonrpc: "2.0",
      id: "oauth-tools",
      method: "tools/list",
      params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } },
    },
  });
  assert.equal(listed.response.status, 200);
  assert.deepEqual(
    listed.data.result.tools.map((tool) => tool.name),
    ["compare_or_decide", "execute_plan", "get_execution_status", "get_service_details", "plan_execution", "search_services"],
  );

  const refreshed = await request("/oauth/token", {
    method: "POST",
    form: true,
    body: {
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: exchanged.data.refresh_token,
      resource,
    },
  });
  assert.equal(refreshed.response.status, 200, refreshed.text);
  assert.ok(refreshed.data.refresh_token);
  assert.notEqual(refreshed.data.refresh_token, exchanged.data.refresh_token);

  const refreshReplay = await request("/oauth/token", {
    method: "POST",
    form: true,
    body: {
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: exchanged.data.refresh_token,
      resource,
    },
  });
  assert.equal(refreshReplay.response.status, 400);

  const revoked = await request("/oauth/revoke", {
    method: "POST",
    form: true,
    body: {
      client_id: clientId,
      token: refreshed.data.access_token,
      token_type_hint: "access_token",
    },
  });
  assert.equal(revoked.response.status, 200);

  const afterRevocation = await request("/mcp", {
    method: "POST",
    headers: mcpHeaders(refreshed.data.access_token),
    body: {
      jsonrpc: "2.0",
      id: "revoked-tools",
      method: "tools/list",
      params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } },
    },
  });
  assert.equal(afterRevocation.response.status, 401);
  assert.equal(afterRevocation.data.code, "INVALID_OAUTH_TOKEN");
  assert.match(afterRevocation.response.headers.get("www-authenticate"), /invalid_token/);
});