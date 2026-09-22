import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  oauthAccessTokensTable,
  oauthAuthorizationCodesTable,
  oauthAuthorizationRequestsTable,
  oauthClientsTable,
  oauthRefreshTokensTable,
} from "@workspace/db";
import { createSession, getCurrentUser } from "../lib/auth";
import {
  OAUTH_CODE_TTL_MS,
  OAUTH_ACCESS_TOKEN_TTL_MS,
  OAUTH_REFRESH_TOKEN_TTL_MS,
  OAUTH_OFFLINE_SCOPE,
  OAUTH_SCOPES,
  apiScopesFromOAuthScopes,
  createOAuthValue,
  hashOAuthValue,
  parseOAuthScopes,
  serializeOAuthScopes,
  verifyPkce,
} from "../lib/oauth";
import {
  authenticateDeveloperKeyQuiet,
  consumePublicRateLimit,
} from "../lib/api-key-auth";
import { publicBaseUrl } from "../lib/public-sitemap";

const router: IRouter = Router();
const OAUTH_ISSUER_PATH = "/";
const MCP_RESOURCE_PATH = "/mcp";
const DEFAULT_OAUTH_SCOPES = "read plan execute";
const OAUTH_REQUEST_TTL_MS = 10 * 60_000;
const OAUTH_AUTH_SESSION_TTL_MS = 10 * 60_000;

class OAuthGrantError extends Error {
  constructor() {
    super("oauth_grant_invalid");
  }
}

type AuthorizeRequest = {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource: string;
  responseType: "code";
};

function value(value: unknown) {
  return typeof value === "string" ? value : "";
}

function baseUrl(req: Request) {
  return publicBaseUrl(req).replace(/\/+$/, "");
}

function issuerUrl(req: Request) {
  return new URL(OAUTH_ISSUER_PATH, `${baseUrl(req)}/`).toString().replace(/\/$/, "");
}

function resourceUrl(req: Request) {
  return new URL(MCP_RESOURCE_PATH, `${baseUrl(req)}/`).toString();
}

function escapeHtml(valueToEscape: string) {
  return valueToEscape
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setNoStore(res: Response) {
  res.set("Cache-Control", "no-store");
  res.set("Pragma", "no-cache");
}

function jsonOAuthError(res: Response, status: number, error: string, errorDescription?: string) {
  setNoStore(res);
  res.status(status).type("application/json").json({
    error,
    ...(errorDescription ? { error_description: errorDescription } : {}),
  });
}

function isAllowedRedirectUri(valueToCheck: string) {
  if (valueToCheck.length === 0 || valueToCheck.length > 2048) return false;
  try {
    const parsed = new URL(valueToCheck);
    if (parsed.username || parsed.password || parsed.hash) return false;
    if (parsed.protocol === "https:") return true;
    return parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]");
  } catch {
    return false;
  }
}

function parseRedirectUris(valueToParse: string) {
  try {
    const parsed: unknown = JSON.parse(valueToParse);
    return Array.isArray(parsed) && parsed.every((uri) => typeof uri === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function clientRedirectUris(client: typeof oauthClientsTable.$inferSelect) {
  return parseRedirectUris(client.redirectUris);
}

async function findClient(clientId: string) {
  const [client] = await db
    .select()
    .from(oauthClientsTable)
    .where(and(eq(oauthClientsTable.clientId, clientId), isNull(oauthClientsTable.revokedAt)))
    .limit(1);
  return client ?? null;
}

function parseAuthorizeRequest(query: Record<string, unknown>, expectedResource: string): AuthorizeRequest | null {
  const responseType = value(query.response_type);
  const clientId = value(query.client_id);
  const redirectUri = value(query.redirect_uri);
  const scope = value(query.scope) || DEFAULT_OAUTH_SCOPES;
  const state = value(query.state);
  const codeChallenge = value(query.code_challenge);
  const codeChallengeMethod = value(query.code_challenge_method);
  const resource = value(query.resource) || expectedResource;
  if (
    responseType !== "code" ||
    !clientId ||
    !redirectUri ||
    !state ||
    !codeChallenge ||
    codeChallengeMethod !== "S256" ||
    resource !== expectedResource ||
    !/^[A-Za-z0-9._~-]{43,128}$/.test(codeChallenge)
  ) {
    return null;
  }
  const rawScopes = scope.split(/\s+/).filter(Boolean);
  if (rawScopes.some((scopeValue) => !OAUTH_SCOPES.includes(scopeValue as (typeof OAUTH_SCOPES)[number]))) return null;
  const scopes = parseOAuthScopes(scope);
  if (scopes.length === 0 || apiScopesFromOAuthScopes(scopes).length === 0) return null;
  return {
    clientId,
    redirectUri,
    scope: serializeOAuthScopes(scopes),
    state,
    codeChallenge,
    codeChallengeMethod: "S256",
    resource,
    responseType: "code",
  };
}

function authorizeQuery(request: AuthorizeRequest) {
  const query = new URLSearchParams({
    response_type: request.responseType,
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    scope: request.scope,
    state: request.state,
    code_challenge: request.codeChallenge,
    code_challenge_method: request.codeChallengeMethod,
    resource: request.resource,
  });
  return query.toString();
}

function requestFromStoredRow(
  row: typeof oauthAuthorizationRequestsTable.$inferSelect,
): AuthorizeRequest {
  return {
    clientId: row.clientId,
    redirectUri: row.redirectUri,
    scope: row.scopes,
    state: row.state,
    codeChallenge: row.codeChallenge,
    codeChallengeMethod: "S256",
    resource: row.resource,
    responseType: "code",
  };
}

async function findAuthorizationRequest(rawRequest: string) {
  const [request] = await db
    .select()
    .from(oauthAuthorizationRequestsTable)
    .where(and(
      eq(oauthAuthorizationRequestsTable.requestHash, hashOAuthValue(rawRequest)),
      isNull(oauthAuthorizationRequestsTable.consumedAt),
      gt(oauthAuthorizationRequestsTable.expiresAt, new Date()),
    ))
    .limit(1);
  return request ?? null;
}

function matchesAuthorizationRequest(
  row: typeof oauthAuthorizationRequestsTable.$inferSelect,
  request: AuthorizeRequest,
) {
  return row.clientId === request.clientId &&
    row.redirectUri === request.redirectUri &&
    row.scopes === request.scope &&
    row.state === request.state &&
    row.codeChallenge === request.codeChallenge &&
    row.resource === request.resource;
}

function redirectWithOAuthError(
  res: Response,
  redirectUri: string,
  error: string,
  state: string,
) {
  const target = new URL(redirectUri);
  target.searchParams.set("error", error);
  target.searchParams.set("state", state);
  res.redirect(302, target.toString());
}

function sameBond402Origin(req: Request) {
  const suppliedOrigin = req.get("origin") || req.get("referer");
  if (!suppliedOrigin) return true;
  try {
    return new URL(suppliedOrigin).origin === new URL(`${baseUrl(req)}/`).origin;
  } catch {
    return false;
  }
}

function secureDeveloperKeyTransport(req: Request) {
  if (req.secure) return true;
  return process.env.NODE_ENV !== "production" &&
    ["127.0.0.1", "localhost", "::1"].includes(req.hostname);
}

function authorizationContinuePath(
  request: AuthorizeRequest,
  transactionToken: string,
) {
  return `/oauth/authorize?${authorizeQuery(request)}&transaction=${encodeURIComponent(transactionToken)}`;
}

function renderConsentPage(
  req: Request,
  res: Response,
  request: AuthorizeRequest,
  clientName: string,
  transaction: string,
  csrfToken: string,
) {
  const action = `${baseUrl(req)}/oauth/authorize/decision`;
  const scopes = parseOAuthScopes(request.scope);
  setNoStore(res);
  res.type("html").send(`<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bond402 OAuth-Berechtigung</title>
<style>
body{font-family:system-ui,sans-serif;background:#0b1220;color:#eef2ff;margin:0;padding:2rem}
main{max-width:32rem;margin:4rem auto;background:#111b2e;border:1px solid #334155;border-radius:1rem;padding:2rem}
h1{font-size:1.4rem;margin-top:0}li{margin:.55rem 0}button{border:0;border-radius:.6rem;padding:.75rem 1rem;font-weight:700;cursor:pointer}
.approve{background:#38bdf8;color:#082f49}.deny{background:#334155;color:#eef2ff;margin-left:.5rem}
.muted{color:#a7b4cb;font-size:.9rem}
</style>
</head>
<body><main>
<h1>Bond402-Zugriff bestätigen</h1>
<p><strong>${escapeHtml(clientName)}</strong> möchte auf Bond402 zugreifen.</p>
<p class="muted">Die Berechtigungen gelten nur für diesen OAuth-Client und werden nicht als langlebiges Developer-Secret an den Client übertragen.</p>
<ul>${scopes.map((scope) => `<li>${escapeHtml(scope)}</li>`).join("")}</ul>
<form method="post" action="${escapeHtml(action)}">
${Object.entries({
  transaction,
  csrf_token: csrfToken,
}).map(([key, fieldValue]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(String(fieldValue))}">`).join("")}
<button class="approve" name="decision" value="approve" type="submit">Erlauben</button>
<button class="deny" name="decision" value="deny" type="submit">Ablehnen</button>
</form>
</main></body></html>`);
}

async function issueTokenPair(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: { ownerId: string; clientId: string; scopes: string; resource: string; familyId?: string },
) {
  const now = new Date();
  const accessToken = createOAuthValue("access");
  const refreshToken = createOAuthValue("refresh");
  const familyId = input.familyId ?? crypto.randomUUID();
  const accessId = crypto.randomUUID();
  const refreshId = crypto.randomUUID();
  const scopes = parseOAuthScopes(input.scopes);
  await tx.insert(oauthAccessTokensTable).values({
    id: accessId,
    tokenHash: hashOAuthValue(accessToken),
    clientId: input.clientId,
    ownerId: input.ownerId,
    resource: input.resource,
    scopes: serializeOAuthScopes(scopes),
    createdAt: now,
    expiresAt: new Date(now.getTime() + OAUTH_ACCESS_TOKEN_TTL_MS),
  });
  if (scopes.includes(OAUTH_OFFLINE_SCOPE)) {
    await tx.insert(oauthRefreshTokensTable).values({
      id: refreshId,
      tokenHash: hashOAuthValue(refreshToken),
      familyId,
      clientId: input.clientId,
      ownerId: input.ownerId,
      resource: input.resource,
      scopes: serializeOAuthScopes(scopes),
      createdAt: now,
      expiresAt: new Date(now.getTime() + OAUTH_REFRESH_TOKEN_TTL_MS),
    });
  }
  return {
    accessToken,
    refreshToken: scopes.includes(OAUTH_OFFLINE_SCOPE) ? refreshToken : null,
    refreshTokenId: scopes.includes(OAUTH_OFFLINE_SCOPE) ? refreshId : null,
    expiresIn: Math.floor(OAUTH_ACCESS_TOKEN_TTL_MS / 1000),
    scope: serializeOAuthScopes(scopes),
  };
}

function tokenResponse(pair: Awaited<ReturnType<typeof issueTokenPair>>) {
  return {
    token_type: "Bearer",
    access_token: pair.accessToken,
    expires_in: pair.expiresIn,
    scope: pair.scope,
    ...(pair.refreshToken ? {
      refresh_token: pair.refreshToken,
      refresh_token_expires_in: Math.floor(OAUTH_REFRESH_TOKEN_TTL_MS / 1000),
    } : {}),
  };
}

router.get("/.well-known/oauth-protected-resource", (req, res): void => {
  setNoStore(res);
  res.json({
    resource: resourceUrl(req),
    authorization_servers: [issuerUrl(req)],
    bearer_methods_supported: ["header"],
    scopes_supported: [...OAUTH_SCOPES],
    resource_documentation: `${baseUrl(req)}/api-docs`,
  });
});

router.get("/.well-known/oauth-protected-resource/mcp", (req, res): void => {
  setNoStore(res);
  res.json({
    resource: resourceUrl(req),
    authorization_servers: [issuerUrl(req)],
    bearer_methods_supported: ["header"],
    scopes_supported: [...OAUTH_SCOPES],
    resource_documentation: `${baseUrl(req)}/api-docs`,
  });
});

router.get("/mcp/.well-known/oauth-protected-resource", (req, res): void => {
  setNoStore(res);
  res.json({
    resource: resourceUrl(req),
    authorization_servers: [issuerUrl(req)],
    bearer_methods_supported: ["header"],
    scopes_supported: [...OAUTH_SCOPES],
    resource_documentation: `${baseUrl(req)}/api-docs`,
  });
});

router.get("/.well-known/oauth-authorization-server", (req, res): void => {
  const issuer = issuerUrl(req);
  setNoStore(res);
  res.json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...OAUTH_SCOPES],
  });
});

router.post("/oauth/register", async (req, res): Promise<void> => {
  const registrationRate = await consumePublicRateLimit(req.ip ?? "unknown", "oauth-register", 10);
  if (!registrationRate.allowed) {
    res.set("Retry-After", String(registrationRate.retryAfter));
    jsonOAuthError(res, 429, "temporarily_unavailable", "Too many client registration requests.");
    return;
  }
  const redirectUris = req.body?.redirect_uris;
  const clientName = typeof req.body?.client_name === "string"
    ? req.body.client_name.trim().slice(0, 120)
    : "MCP Client";
  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length === 0 ||
    redirectUris.length > 10 ||
    !redirectUris.every((uri): uri is string => typeof uri === "string" && isAllowedRedirectUri(uri))
  ) {
    jsonOAuthError(res, 400, "invalid_client_metadata", "redirect_uris must contain 1 to 10 exact HTTPS redirect URIs.");
    return;
  }
  if (req.body?.token_endpoint_auth_method && req.body.token_endpoint_auth_method !== "none") {
    jsonOAuthError(res, 400, "invalid_client_metadata", "Only public PKCE clients using token_endpoint_auth_method=none are supported.");
    return;
  }
  if (req.body?.grant_types && (
    !Array.isArray(req.body.grant_types) ||
    req.body.grant_types.length === 0 ||
    req.body.grant_types.some((grantType: unknown) => !["authorization_code", "refresh_token"].includes(String(grantType)))
  )) {
    jsonOAuthError(res, 400, "invalid_client_metadata", "Only authorization_code and refresh_token are supported.");
    return;
  }
  if (req.body?.response_types && (
    !Array.isArray(req.body.response_types) ||
    req.body.response_types.length === 0 ||
    req.body.response_types.some((responseType: unknown) => responseType !== "code")
  )) {
    jsonOAuthError(res, 400, "invalid_client_metadata", "Only response_type=code is supported.");
    return;
  }
  if (req.body?.scope !== undefined && (
    typeof req.body.scope !== "string" ||
    req.body.scope.split(/\s+/).some((scopeValue: string) =>
      Boolean(scopeValue) && !OAUTH_SCOPES.includes(scopeValue as (typeof OAUTH_SCOPES)[number])
    )
  )) {
    jsonOAuthError(res, 400, "invalid_client_metadata", "The requested scope is not supported.");
    return;
  }
  const clientId = `b402_client_${randomBytes(18).toString("base64url")}`;
  const grantTypes = Array.isArray(req.body?.grant_types)
    ? req.body.grant_types
    : ["authorization_code", "refresh_token"];
  const responseTypes = Array.isArray(req.body?.response_types)
    ? req.body.response_types
    : ["code"];
  await db.insert(oauthClientsTable).values({
    clientId,
    clientName: clientName || "MCP Client",
    redirectUris: JSON.stringify([...new Set(redirectUris)]),
    grantTypes: grantTypes.join(","),
    responseTypes: responseTypes.join(","),
  });
  setNoStore(res);
  res.status(201).json({
    client_id: clientId,
    client_name: clientName || "MCP Client",
    redirect_uris: [...new Set(redirectUris)],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: [...OAUTH_SCOPES].join(" "),
  });
});

router.get("/oauth/authorize", async (req, res): Promise<void> => {
  const expectedResource = resourceUrl(req);
  const clientId = value(req.query.client_id);
  const redirectUri = value(req.query.redirect_uri);
  const client = clientId ? await findClient(clientId) : null;
  if (!client || !clientRedirectUris(client).includes(redirectUri)) {
    jsonOAuthError(res, 400, "invalid_request", "The client_id and redirect_uri combination is invalid.");
    return;
  }
  const request = parseAuthorizeRequest(req.query, expectedResource);
  if (!request) {
    jsonOAuthError(res, 400, "invalid_request", "Authorization requires response_type=code, state and S256 PKCE.");
    return;
  }
  if (
    request.clientId.length > 160 ||
    request.redirectUri.length > 2048 ||
    request.state.length > 512 ||
    request.scope.length > 256 ||
    request.resource.length > 2048
  ) {
    jsonOAuthError(res, 400, "invalid_request", "Authorization request parameters are too long.");
    return;
  }
  const user = await getCurrentUser(req);
  const transactionValue = value(req.query.transaction);
  let transactionToken = transactionValue;
  let transaction = transactionValue ? await findAuthorizationRequest(transactionValue) : null;
  if (transactionValue && (!transaction || !matchesAuthorizationRequest(transaction, request))) {
    jsonOAuthError(res, 400, "invalid_request", "The authorization transaction is invalid or expired.");
    return;
  }
  if (!transaction) {
    transactionToken = createOAuthValue("request");
    transaction = (await db.insert(oauthAuthorizationRequestsTable).values({
      id: crypto.randomUUID(),
      requestHash: hashOAuthValue(transactionToken),
      clientId: request.clientId,
      ownerId: user?.id ?? null,
      redirectUri: request.redirectUri,
      scopes: request.scope,
      state: request.state,
      codeChallenge: request.codeChallenge,
      codeChallengeMethod: request.codeChallengeMethod,
      resource: request.resource,
      expiresAt: new Date(Date.now() + OAUTH_REQUEST_TTL_MS),
    }).returning())[0] ?? null;
  }
  if (!transaction) {
    jsonOAuthError(res, 500, "temporarily_unavailable", "The authorization transaction could not be created.");
    return;
  }
  if (user && transaction.ownerId && transaction.ownerId !== user.id) {
    jsonOAuthError(res, 403, "access_denied", "The authorization transaction belongs to another owner session.");
    return;
  }
  if (user && !transaction.ownerId) {
    await db.update(oauthAuthorizationRequestsTable)
      .set({ ownerId: user.id })
      .where(eq(oauthAuthorizationRequestsTable.id, transaction.id));
    transaction = { ...transaction, ownerId: user.id };
  }
  if (!user) {
    const loginUrl = new URL("/sign-in", `${baseUrl(req)}/`);
    loginUrl.searchParams.set("returnTo", authorizationContinuePath(request, transactionToken));
    res.redirect(302, loginUrl.toString());
    return;
  }
  const csrfToken = createOAuthValue("csrf");
  await db.update(oauthAuthorizationRequestsTable)
    .set({ csrfHash: hashOAuthValue(csrfToken) })
    .where(eq(oauthAuthorizationRequestsTable.id, transaction.id));
  renderConsentPage(req, res, request, client.clientName, transactionToken, csrfToken);
});

router.post("/oauth/authorize/developer-key", async (req, res): Promise<void> => {
  if (!secureDeveloperKeyTransport(req)) {
    jsonOAuthError(res, 400, "invalid_request", "Developer-Key-Verifizierung ist nur über eine sichere Bond402-Verbindung erlaubt.");
    return;
  }
  if (!sameBond402Origin(req)) {
    jsonOAuthError(res, 403, "access_denied", "Die Developer-Key-Verifizierung muss von Bond402 selbst ausgehen.");
    return;
  }

  const transactionToken = value(req.body?.transaction);
  const rawDeveloperKey = value(req.body?.developer_key);
  const transaction = transactionToken ? await findAuthorizationRequest(transactionToken) : null;
  if (
    !transaction ||
    rawDeveloperKey.length > 512
  ) {
    jsonOAuthError(res, 400, "invalid_request", "Die OAuth-Autorisierung ist ungültig oder abgelaufen.");
    return;
  }

  const currentUser = await getCurrentUser(req);
  const keyResult = await authenticateDeveloperKeyQuiet(req, rawDeveloperKey);
  if ("failure" in keyResult) {
    if (keyResult.failure.retryAfterSeconds !== null) {
      res.set("Retry-After", String(keyResult.failure.retryAfterSeconds));
    }
    jsonOAuthError(
      res,
      keyResult.failure.status,
      keyResult.failure.code === "RATE_LIMITED" ? "temporarily_unavailable" : "access_denied",
      keyResult.failure.code === "RATE_LIMITED"
        ? "Zu viele Developer-Key-Prüfungen. Bitte später erneut versuchen."
        : "Der Developer-Key ist ungültig.",
    );
    return;
  }

  const ownerId = keyResult.auth.ownerId;
  const requestedApiScopes = apiScopesFromOAuthScopes(parseOAuthScopes(transaction.scopes));
  if (!requestedApiScopes.every((scope) => keyResult.auth.scopes.includes(scope))) {
    jsonOAuthError(res, 403, "access_denied", "Der Developer-Key besitzt nicht alle angeforderten OAuth-Berechtigungen.");
    return;
  }
  if (
    (currentUser && currentUser.id !== ownerId) ||
    (transaction.ownerId && transaction.ownerId !== ownerId)
  ) {
    jsonOAuthError(res, 403, "access_denied", "Die OAuth-Autorisierung gehört zu einem anderen Bond402-Owner.");
    return;
  }

  if (!transaction.ownerId) {
    await db.update(oauthAuthorizationRequestsTable)
      .set({ ownerId })
      .where(and(
        eq(oauthAuthorizationRequestsTable.id, transaction.id),
        isNull(oauthAuthorizationRequestsTable.ownerId),
      ));
  }
  const boundTransaction = await findAuthorizationRequest(transactionToken);
  if (!boundTransaction || boundTransaction.ownerId !== ownerId) {
    jsonOAuthError(res, 403, "access_denied", "Die OAuth-Autorisierung konnte nicht sicher an den Owner gebunden werden.");
    return;
  }
  const client = await findClient(boundTransaction.clientId);
  if (!client || !clientRedirectUris(client).includes(boundTransaction.redirectUri)) {
    jsonOAuthError(res, 400, "invalid_request", "Der OAuth-Client ist ungültig.");
    return;
  }

  await createSession(ownerId, res, { durationMs: OAUTH_AUTH_SESSION_TTL_MS });
  setNoStore(res);
  res.json({
    continueTo: authorizationContinuePath(requestFromStoredRow(boundTransaction), transactionToken),
  });
});

router.post("/oauth/authorize/decision", async (req, res): Promise<void> => {
  if (!sameBond402Origin(req)) {
    jsonOAuthError(res, 403, "access_denied", "The authorization decision origin is not allowed.");
    return;
  }
  const transactionToken = value(req.body?.transaction);
  const csrfToken = value(req.body?.csrf_token);
  const transaction = transactionToken ? await findAuthorizationRequest(transactionToken) : null;
  const user = await getCurrentUser(req);
  if (!transaction || !user || transaction.ownerId !== user.id || !transaction.csrfHash ||
      hashOAuthValue(csrfToken) !== transaction.csrfHash) {
    jsonOAuthError(res, 400, "invalid_request", "The authorization transaction or CSRF proof is invalid.");
    return;
  }
  const client = await findClient(transaction.clientId);
  if (!client || !clientRedirectUris(client).includes(transaction.redirectUri)) {
    jsonOAuthError(res, 400, "invalid_request", "The authorization client is invalid.");
    return;
  }
  const request = requestFromStoredRow(transaction);
  if (req.body?.decision !== "approve") {
    await db.update(oauthAuthorizationRequestsTable)
      .set({ consumedAt: new Date() })
      .where(and(eq(oauthAuthorizationRequestsTable.id, transaction.id), isNull(oauthAuthorizationRequestsTable.consumedAt)));
    redirectWithOAuthError(res, request.redirectUri, "access_denied", request.state);
    return;
  }
  const code = createOAuthValue("code");
  try {
    await db.transaction(async (tx) => {
      const [consumed] = await tx.update(oauthAuthorizationRequestsTable)
        .set({ consumedAt: new Date() })
        .where(and(eq(oauthAuthorizationRequestsTable.id, transaction.id), isNull(oauthAuthorizationRequestsTable.consumedAt)))
        .returning({ id: oauthAuthorizationRequestsTable.id });
      if (!consumed) throw new OAuthGrantError();
      await tx.insert(oauthAuthorizationCodesTable).values({
        id: crypto.randomUUID(),
        codeHash: hashOAuthValue(code),
        clientId: request.clientId,
        ownerId: user.id,
        redirectUri: request.redirectUri,
        scopes: request.scope,
        codeChallenge: request.codeChallenge,
        codeChallengeMethod: request.codeChallengeMethod,
        resource: request.resource,
        expiresAt: new Date(Date.now() + OAUTH_CODE_TTL_MS),
      });
    });
  } catch (error) {
    if (error instanceof OAuthGrantError) {
      jsonOAuthError(res, 400, "invalid_request", "The authorization transaction was already used.");
      return;
    }
    throw error;
  }
  const callback = new URL(request.redirectUri);
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", request.state);
  res.redirect(302, callback.toString());
});

router.post("/oauth/token", async (req, res): Promise<void> => {
  const grantType = value(req.body?.grant_type);
  const clientId = value(req.body?.client_id);
  const client = clientId ? await findClient(clientId) : null;
  if (!client || client.tokenEndpointAuthMethod !== "none") {
    jsonOAuthError(res, 401, "invalid_client");
    return;
  }
  if (!client.grantTypes.split(",").includes(grantType)) {
    jsonOAuthError(res, 400, "unauthorized_client");
    return;
  }
  if (grantType === "authorization_code") {
    const codeValue = value(req.body?.code);
    const redirectUri = value(req.body?.redirect_uri);
    const codeVerifier = value(req.body?.code_verifier);
    const resource = value(req.body?.resource) || resourceUrl(req);
    let pair: Awaited<ReturnType<typeof issueTokenPair>>;
    try {
      pair = await db.transaction(async (tx) => {
        const [code] = await tx
          .select()
          .from(oauthAuthorizationCodesTable)
          .where(and(
            eq(oauthAuthorizationCodesTable.codeHash, hashOAuthValue(codeValue)),
            eq(oauthAuthorizationCodesTable.clientId, clientId),
            isNull(oauthAuthorizationCodesTable.consumedAt),
            gt(oauthAuthorizationCodesTable.expiresAt, new Date()),
          ))
          .limit(1);
        if (
          !code ||
          code.redirectUri !== redirectUri ||
          code.resource !== resource ||
          !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier) ||
          !verifyPkce(codeVerifier, code.codeChallenge)
        ) {
          throw new OAuthGrantError();
        }
        const [consumed] = await tx
          .update(oauthAuthorizationCodesTable)
          .set({ consumedAt: new Date() })
          .where(and(
            eq(oauthAuthorizationCodesTable.id, code.id),
            isNull(oauthAuthorizationCodesTable.consumedAt),
          ))
          .returning({ id: oauthAuthorizationCodesTable.id });
        if (!consumed) throw new OAuthGrantError();
        return issueTokenPair(tx, {
          ownerId: code.ownerId,
          clientId,
          scopes: code.scopes,
          resource,
        });
      });
    } catch (error) {
      if (error instanceof OAuthGrantError) {
        jsonOAuthError(res, 400, "invalid_grant", "The authorization code, redirect URI, resource or PKCE verifier is invalid.");
        return;
      }
      throw error;
    }
    await db.update(oauthClientsTable).set({ lastUsedAt: new Date() }).where(eq(oauthClientsTable.clientId, clientId));
    setNoStore(res);
    res.json(tokenResponse(pair));
    return;
  }
  if (grantType === "refresh_token") {
    const rawRefreshToken = value(req.body?.refresh_token);
    const resource = value(req.body?.resource) || resourceUrl(req);
    let pair: Awaited<ReturnType<typeof issueTokenPair>>;
    try {
      pair = await db.transaction(async (tx) => {
        const [refresh] = await tx
          .select()
          .from(oauthRefreshTokensTable)
          .where(eq(oauthRefreshTokensTable.tokenHash, hashOAuthValue(rawRefreshToken)))
          .limit(1);
        if (
          !refresh ||
          refresh.clientId !== clientId ||
          refresh.resource !== resource ||
          refresh.expiresAt <= new Date()
        ) {
          throw new OAuthGrantError();
        }
        if (refresh.revokedAt || refresh.usedAt) {
          await tx.update(oauthRefreshTokensTable)
            .set({ revokedAt: new Date() })
            .where(eq(oauthRefreshTokensTable.familyId, refresh.familyId));
          throw new OAuthGrantError();
        }
        const [marked] = await tx.update(oauthRefreshTokensTable)
          .set({ usedAt: new Date() })
          .where(and(
            eq(oauthRefreshTokensTable.id, refresh.id),
            isNull(oauthRefreshTokensTable.usedAt),
            isNull(oauthRefreshTokensTable.revokedAt),
          ))
          .returning({ id: oauthRefreshTokensTable.id });
        if (!marked) throw new OAuthGrantError();
        const next = await issueTokenPair(tx, {
          ownerId: refresh.ownerId,
          clientId,
          scopes: refresh.scopes,
          resource,
          familyId: refresh.familyId,
        });
        if (next.refreshTokenId) {
          await tx.update(oauthRefreshTokensTable)
            .set({ replacedById: next.refreshTokenId })
            .where(eq(oauthRefreshTokensTable.id, refresh.id));
        }
        return next;
      });
    } catch (error) {
      if (error instanceof OAuthGrantError) {
        jsonOAuthError(res, 400, "invalid_grant", "The refresh token is invalid, expired, revoked or was already used.");
        return;
      }
      throw error;
    }
    setNoStore(res);
    res.json(tokenResponse(pair));
    return;
  }
  jsonOAuthError(res, 400, "unsupported_grant_type");
});

router.post("/oauth/revoke", async (req, res): Promise<void> => {
  const rawToken = value(req.body?.token);
  const clientId = value(req.body?.client_id);
  if (rawToken && clientId) {
    const tokenHash = hashOAuthValue(rawToken);
    await db.update(oauthAccessTokensTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(oauthAccessTokensTable.tokenHash, tokenHash), eq(oauthAccessTokensTable.clientId, clientId)));
    const [refresh] = await db.select({ familyId: oauthRefreshTokensTable.familyId })
      .from(oauthRefreshTokensTable)
      .where(and(eq(oauthRefreshTokensTable.tokenHash, tokenHash), eq(oauthRefreshTokensTable.clientId, clientId)))
      .limit(1);
    if (refresh) {
      await db.update(oauthRefreshTokensTable)
        .set({ revokedAt: new Date() })
        .where(eq(oauthRefreshTokensTable.familyId, refresh.familyId));
    }
  }
  setNoStore(res);
  res.status(200).end();
});

export default router;