import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createHash, randomBytes, randomUUID, scrypt as nodeScrypt } from "node:crypto";
import { test, before, after } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
const port = Number(process.env.BOND402_OAUTH_TEST_PORT || 18129);
const baseUrl = `http://127.0.0.1:${port}`;
const publicBaseUrl = "https://bond402.vercel.app";
const publicMcpResource = `${publicBaseUrl}/mcp`;
const testId = randomUUID();
let requestCount = 0;
const userId = `oauth-test-user-${testId}`;
const email = `${testId}@oauth.test`;
const password = `OAuth-Test-Password-402!`;
const sessionToken = randomBytes(32).toString("base64url");
const sessionHash = createHash("sha256").update(sessionToken, "utf8").digest("hex");
const developerKey = `b402_${randomBytes(32).toString("base64url")}`;
const developerKeyId = randomUUID();
const developerKeyHash = createHash("sha256").update(developerKey, "utf8").digest("hex");
const redirectUri = `https://oauth-client-${testId}.example/callback`;
let server;
let clientId;
const registeredClientIds = [];

class CookieJar {
  value = "";

  capture(response) {
    const setCookie = response.headers.get("set-cookie");
    const match = setCookie?.match(/bond402_session=([^;]*)/);
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
    ${registeredClientIds.length
      ? `DELETE FROM bond402_oauth_clients WHERE client_id IN (${registeredClientIds.map(sqlLiteral).join(", ")});`
      : ""}
    DELETE FROM bond402_api_rate_limits
    WHERE identity IN (${sqlLiteral(`key:${developerKeyId}`)}, ${sqlLiteral(`owner:${userId}`)})
       OR identity LIKE ${sqlLiteral(`key:${developerKeyId}%`)};
    DELETE FROM bond402_api_keys WHERE id = ${sqlLiteral(developerKeyId)};
    DELETE FROM bond402_sessions WHERE user_id = ${sqlLiteral(userId)};
    DELETE FROM bond402_users WHERE id = ${sqlLiteral(userId)};
  `);
}

async function request(path, options = {}) {
  const {
    body,
    form = false,
    authenticated = false,
    cookieJar,
    redirect = "follow",
    ...fetchOptions
  } = options;
  const headers = {
    "X-Forwarded-For": `198.51.100.${(requestCount++ % 250) + 1}`,
    ...(body === undefined ? {} : {
      "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json",
    }),
    ...(authenticated ? { Cookie: `bond402_session=${sessionToken}` } : {}),
    ...(cookieJar?.header() ? { Cookie: cookieJar.header() } : {}),
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
  cookieJar?.capture(response);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { response, data, text };
}

function hashPassword(passwordValue) {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    nodeScrypt(
      passwordValue,
      salt,
      64,
      { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(`${salt.toString("hex")}:${derivedKey.toString("hex")}`);
      },
    );
  });
}

function authorizeUrl() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  const state = `state-flow-${randomUUID()}`;
  const authorize = new URL("/oauth/authorize", baseUrl);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read plan execute audit offline_access",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: publicMcpResource,
  }).toString();
  return { authorize, verifier, state };
}

function requestPath(url) {
  return `${url.pathname}${url.search}`;
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

function mcpHeaders(accessToken, version = "2026-07-28") {
  return {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": version,
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

async function issueAccessToken(scopes, label) {
  const redirect = `https://oauth-client-${testId}-${label}.example/callback`;
  const registered = await request("/oauth/register", {
    method: "POST",
    body: {
      client_name: `OAuth MCP ${label}`,
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: scopes.join(" "),
    },
  });
  assert.equal(registered.response.status, 201, registered.text);
  const issuedClientId = registered.data.client_id;
  registeredClientIds.push(issuedClientId);

  const { verifier, challenge } = pkce();
  const state = `state-${label}-${randomUUID()}`;
  const authorize = new URL("/oauth/authorize", baseUrl);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: issuedClientId,
    redirect_uri: redirect,
    scope: scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: publicMcpResource,
  }).toString();
  const consent = await request(`${authorize.pathname}${authorize.search}`, {
    authenticated: true,
    redirect: "manual",
  });
  assert.equal(consent.response.status, 200, consent.text);
  const transaction = hiddenValue(consent.text, "transaction");
  const csrfToken = hiddenValue(consent.text, "csrf_token");
  assert.ok(transaction);
  assert.ok(csrfToken);

  const decision = await request("/oauth/authorize/decision", {
    method: "POST",
    authenticated: true,
    form: true,
    redirect: "manual",
    body: { transaction, csrf_token: csrfToken, decision: "approve" },
  });
  assert.equal(decision.response.status, 302, decision.text);
  const callback = new URL(decision.response.headers.get("location"));
  const code = callback.searchParams.get("code");
  assert.ok(code);

  const exchanged = await request("/oauth/token", {
    method: "POST",
    form: true,
    body: {
      grant_type: "authorization_code",
      client_id: issuedClientId,
      code,
      redirect_uri: redirect,
      code_verifier: verifier,
      resource: publicMcpResource,
    },
  });
  assert.equal(exchanged.response.status, 200, exchanged.text);
  return {
    accessToken: exchanged.data.access_token,
    clientId: issuedClientId,
    resource: publicMcpResource,
  };
}

async function mcpCall(accessToken, method, params, id = randomUUID()) {
  const response = await request("/mcp", {
    method: "POST",
    headers: mcpHeaders(accessToken),
    body: { jsonrpc: "2.0", id, method, params },
  });
  const text = response.data?.result?.content?.find((item) => item.type === "text")?.text;
  return {
    ...response,
    result: text ? JSON.parse(text) : null,
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
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      PUBLIC_BASE_URL: publicBaseUrl,
    },
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
  const passwordHash = await hashPassword(password);
  runSql(`
    INSERT INTO bond402_users (id, email, display_name, password_hash, email_verification_required)
    VALUES (${sqlLiteral(userId)}, ${sqlLiteral(email)}, 'OAuth Routentest', ${sqlLiteral(passwordHash)}, false);
    INSERT INTO bond402_sessions (id, user_id, token_hash, expires_at)
    VALUES (${sqlLiteral(randomUUID())}, ${sqlLiteral(userId)}, ${sqlLiteral(sessionHash)}, NOW() + INTERVAL '1 hour');
    INSERT INTO bond402_api_keys (id, owner_id, name, key_hash, prefix, scopes)
    VALUES (
      ${sqlLiteral(developerKeyId)},
      ${sqlLiteral(userId)},
      'OAuth developer-key fixture',
      ${sqlLiteral(developerKeyHash)},
      ${sqlLiteral(`${developerKey.slice(0, 13)}…`)},
      'read,plan,execute,audit'
    );
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
  assert.equal(resource.data.resource, publicMcpResource);
  assert.deepEqual(resource.data.bearer_methods_supported, ["header"]);
  assert.ok(resource.data.authorization_servers.includes(publicBaseUrl));

  const authorizationServer = await request("/.well-known/oauth-authorization-server");
  assert.equal(authorizationServer.response.status, 200);
  assert.equal(authorizationServer.data.authorization_endpoint, `${publicBaseUrl}/oauth/authorize`);
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
  registeredClientIds.push(clientId);
  assert.match(clientId, /^b402_client_/);
  assert.equal(registered.data.client_secret, undefined);
});

test("OAuth PKCE authorization, replay protection, scope visibility, rotation and revocation work", async () => {
  assert.ok(clientId, "client registration must run first");
  const { verifier, challenge } = pkce();
  const state = `state-${randomUUID()}`;
   const resource = publicMcpResource;
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

test("OAuth scope matrix controls tools/list visibility", async () => {
  const cases = [
    ["read", ["read"], ["compare_or_decide", "get_service_details", "search_services"]],
    ["plan", ["plan"], ["compare_or_decide", "plan_execution", "search_services"]],
    ["execute", ["execute"], ["compare_or_decide", "execute_plan", "search_services"]],
    ["audit", ["audit"], ["compare_or_decide", "get_execution_status", "search_services"]],
    ["all", ["read", "plan", "execute", "audit"], ["compare_or_decide", "execute_plan", "get_execution_status", "get_service_details", "plan_execution", "search_services"]],
  ];

  for (const [label, scopes, expected] of cases) {
    const token = await issueAccessToken(scopes, `matrix-${label}`);
    const listed = await mcpCall(token.accessToken, "tools/list", {});
    assert.equal(listed.response.status, 200, listed.text);
    assert.deepEqual(listed.data.result.tools.map((tool) => tool.name), expected);
  }
});

test("Unauthenticated authorize resumes after Bond402 login and binds the MCP token to that owner", async () => {
  const { authorize, verifier, state } = authorizeUrl();
  const anonymous = await request(requestPath(authorize), { redirect: "manual" });
  assert.equal(anonymous.response.status, 302);
  const loginLocation = new URL(anonymous.response.headers.get("location"));
  assert.equal(loginLocation.pathname, "/sign-in");
  const returnTo = loginLocation.searchParams.get("returnTo");
  assert.ok(returnTo?.startsWith("/oauth/authorize?"));
  assert.doesNotMatch(returnTo, new RegExp(password));
  assert.doesNotMatch(returnTo, new RegExp(sessionToken));

  const jar = new CookieJar();
  const wrongLogin = await request("/api/auth/login", {
    method: "POST",
    cookieJar: jar,
    body: { email, password: "Wrong-OAuth-Password-402!" },
  });
  assert.equal(wrongLogin.response.status, 401);
  assert.equal(wrongLogin.data.code, "INVALID_CREDENTIALS");
  assert.equal(jar.header(), "");

  const login = await request("/api/auth/login", {
    method: "POST",
    cookieJar: jar,
    body: { email, password },
  });
  assert.equal(login.response.status, 200, login.text);
  assert.ok(jar.header());

  const consent = await request(returnTo, { cookieJar: jar, redirect: "manual" });
  assert.equal(consent.response.status, 200, consent.text);
  const transaction = hiddenValue(consent.text, "transaction");
  const csrfToken = hiddenValue(consent.text, "csrf_token");
  assert.ok(transaction);
  assert.ok(csrfToken);

  const decision = await request("/oauth/authorize/decision", {
    method: "POST",
    cookieJar: jar,
    form: true,
    redirect: "manual",
    body: { transaction, csrf_token: csrfToken, decision: "approve" },
  });
  assert.equal(decision.response.status, 302, decision.text);
  const callback = new URL(decision.response.headers.get("location"));
  assert.equal(callback.searchParams.get("state"), state);
  const code = callback.searchParams.get("code");
  assert.ok(code);

  const exchanged = await request("/oauth/token", {
    method: "POST",
    form: true,
    body: {
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource: publicMcpResource,
    },
  });
  assert.equal(exchanged.response.status, 200, exchanged.text);
  const accessTokenHash = createHash("sha256").update(exchanged.data.access_token, "utf8").digest("hex");
  assert.equal(
    runSql(`SELECT owner_id FROM bond402_oauth_access_tokens WHERE token_hash = ${sqlLiteral(accessTokenHash)}`).trim(),
    userId,
  );

  const listed = await request("/mcp", {
    method: "POST",
    headers: mcpHeaders(exchanged.data.access_token),
    body: {
      jsonrpc: "2.0",
      id: "login-tools",
      method: "tools/list",
      params: {},
    },
  });
  assert.equal(listed.response.status, 200);
  assert.deepEqual(
    listed.data.result.tools.map((tool) => tool.name),
    ["compare_or_decide", "execute_plan", "get_execution_status", "get_service_details", "plan_execution", "search_services"],
  );

  const logout = await request("/api/auth/logout", {
    method: "POST",
    cookieJar: jar,
  });
  assert.equal(logout.response.status, 204);
  assert.equal(jar.header(), "");
  const afterLogout = await request(requestPath(authorizeUrl().authorize), {
    cookieJar: jar,
    redirect: "manual",
  });
  assert.equal(afterLogout.response.status, 302);
  assert.equal(new URL(afterLogout.response.headers.get("location")).pathname, "/sign-in");

  const loginAgain = await request("/api/auth/login", {
    method: "POST",
    cookieJar: jar,
    body: { email, password },
  });
  assert.equal(loginAgain.response.status, 200);
  const expiredCookieHash = createHash("sha256")
    .update(jar.value, "utf8")
    .digest("hex");
  runSql(`
    UPDATE bond402_sessions
    SET expires_at = NOW() - INTERVAL '1 minute'
    WHERE token_hash = ${sqlLiteral(expiredCookieHash)}
  `);
  const afterExpiry = await request(requestPath(authorizeUrl().authorize), {
    cookieJar: jar,
    redirect: "manual",
  });
  assert.equal(afterExpiry.response.status, 302);
  assert.equal(new URL(afterExpiry.response.headers.get("location")).pathname, "/sign-in");
});

test("Developer-Key verification creates a short-lived owner session and continues to consent", async () => {
  const { authorize, verifier, state } = authorizeUrl();
  const anonymous = await request(requestPath(authorize), { redirect: "manual" });
  assert.equal(anonymous.response.status, 302);
  const loginLocation = new URL(anonymous.response.headers.get("location"));
  const returnTo = loginLocation.searchParams.get("returnTo");
  const transaction = new URL(returnTo, baseUrl).searchParams.get("transaction");
  assert.ok(transaction);

  const wrongKey = `b402_${randomBytes(32).toString("base64url")}`;
  const rejected = await request("/oauth/authorize/developer-key", {
    method: "POST",
    body: { transaction, developer_key: wrongKey },
  });
  assert.equal(rejected.response.status, 401);
  assert.equal(rejected.data.error, "access_denied");
  assert.doesNotMatch(rejected.text, new RegExp(wrongKey));

  const jar = new CookieJar();
  const verified = await request("/oauth/authorize/developer-key", {
    method: "POST",
    cookieJar: jar,
    body: { transaction, developer_key: developerKey },
  });
  assert.equal(verified.response.status, 200, verified.text);
  assert.ok(jar.header());
  assert.ok(verified.data.continueTo.startsWith("/oauth/authorize?"));
  assert.doesNotMatch(verified.text, new RegExp(developerKey));
  const developerSessionHash = createHash("sha256").update(jar.value, "utf8").digest("hex");
  const sessionSeconds = Number(runSql(`
    SELECT EXTRACT(EPOCH FROM (expires_at - created_at))
    FROM bond402_sessions
    WHERE token_hash = ${sqlLiteral(developerSessionHash)}
  `).trim());
  assert.ok(sessionSeconds > 0 && sessionSeconds <= 10 * 60 + 2);

  const consent = await request(verified.data.continueTo, { cookieJar: jar, redirect: "manual" });
  assert.equal(consent.response.status, 200, consent.text);
  const csrfToken = hiddenValue(consent.text, "csrf_token");
  assert.ok(csrfToken);
  const decision = await request("/oauth/authorize/decision", {
    method: "POST",
    cookieJar: jar,
    form: true,
    redirect: "manual",
    body: { transaction, csrf_token: csrfToken, decision: "approve" },
  });
  assert.equal(decision.response.status, 302, decision.text);
  const callback = new URL(decision.response.headers.get("location"));
  assert.equal(callback.searchParams.get("state"), state);
  const code = callback.searchParams.get("code");
  assert.ok(code);

  const exchanged = await request("/oauth/token", {
    method: "POST",
    form: true,
    body: {
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource: publicMcpResource,
    },
  });
  assert.equal(exchanged.response.status, 200, exchanged.text);
  const accessTokenHash = createHash("sha256").update(exchanged.data.access_token, "utf8").digest("hex");
  assert.equal(
    runSql(`SELECT owner_id FROM bond402_oauth_access_tokens WHERE token_hash = ${sqlLiteral(accessTokenHash)}`).trim(),
    userId,
  );
  const listed = await request("/mcp", {
    method: "POST",
    headers: mcpHeaders(exchanged.data.access_token),
    body: {
      jsonrpc: "2.0",
      id: "developer-key-tools",
      method: "tools/list",
      params: {},
    },
  });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.data.result.tools.some((tool) => tool.name === "execute_plan"), true);
});

test("OAuth-authenticated tools/call enforces missing scopes", async () => {
  const readToken = await issueAccessToken(["read"], "call-read");
  const planToken = await issueAccessToken(["plan"], "call-plan");
  const executeToken = await issueAccessToken(["execute"], "call-execute");
  const auditToken = await issueAccessToken(["audit"], "call-audit");
  const planId = randomUUID();

  const readDetails = await mcpCall(readToken.accessToken, "tools/call", {
    name: "get_service_details",
    arguments: { serviceId: "missing-service" },
  });
  assert.equal(readDetails.response.status, 200);
  assert.equal(readDetails.result.code, "NOT_FOUND");

  const missingPlan = await mcpCall(readToken.accessToken, "tools/call", {
    name: "plan_execution",
    arguments: { serviceId: "external:unverified" },
  });
  assert.equal(missingPlan.response.status, 404);
  assert.equal(missingPlan.data.error.data.code, "UNKNOWN_TOOL");

  const missingExecute = await mcpCall(planToken.accessToken, "tools/call", {
    name: "execute_plan",
    arguments: { planId },
  });
  assert.equal(missingExecute.response.status, 404);
  assert.equal(missingExecute.data.error.data.code, "UNKNOWN_TOOL");

  const missingAudit = await mcpCall(executeToken.accessToken, "tools/call", {
    name: "get_execution_status",
    arguments: { planId },
  });
  assert.equal(missingAudit.response.status, 404);
  assert.equal(missingAudit.data.error.data.code, "UNKNOWN_TOOL");

  const auditLookup = await mcpCall(auditToken.accessToken, "tools/call", {
    name: "get_execution_status",
    arguments: { planId },
  });
  assert.equal(auditLookup.response.status, 200);
  assert.equal(auditLookup.result.code, "NOT_FOUND");
});

test("OAuth MCP Search to Plan to Execute stays deterministic for unverified external fixtures", async () => {
  const planToken = await issueAccessToken(["plan"], "flow-plan");
  const executeToken = await issueAccessToken(["execute"], "flow-execute");
  const task = "deterministic local fixture";

  const search = await mcpCall(null, "tools/call", {
    name: "search_services",
    arguments: { task },
  });
  assert.equal(search.response.status, 200);
  assert.ok(Array.isArray(search.result.candidates));
  assert.equal(search.result.requestId !== undefined, true);

  const plan = await mcpCall(planToken.accessToken, "tools/call", {
    name: "plan_execution",
    arguments: { serviceId: "external:local-fixture", task },
  });
  assert.equal(plan.response.status, 200);
  assert.equal(plan.result.status, "UNVERIFIED_EXTERNAL");
  assert.equal(plan.result.planId, null);

  const execute = await mcpCall(executeToken.accessToken, "tools/call", {
    name: "execute_plan",
    arguments: { planId: randomUUID() },
  });
  assert.equal(execute.response.status, 200);
  assert.notEqual(execute.result.status, "READY");
  assert.equal(execute.result.code, "EXECUTION_PLAN_NOT_FOUND");
});
