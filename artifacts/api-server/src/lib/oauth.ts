import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  oauthAccessTokensTable,
  oauthClientsTable,
  oauthRefreshTokensTable,
  db,
} from "@workspace/db";
import type { ApiKeyScope } from "./api-key-auth";

export const OAUTH_OFFLINE_SCOPE = "offline_access" as const;
export const OAUTH_SCOPES = [
  "read",
  "plan",
  "execute",
  "audit",
  OAUTH_OFFLINE_SCOPE,
] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export const OAUTH_CODE_TTL_MS = 5 * 60_000;
export const OAUTH_ACCESS_TOKEN_TTL_MS = 10 * 60_000;
export const OAUTH_REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;

export type OAuthMcpAuth = {
  ownerId: string;
  keyId: string;
  scopes: ApiKeyScope[];
  credentialType: "oauth";
  clientId: string;
  accessTokenId: string;
};

export function hashOAuthValue(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createOAuthValue(prefix: "code" | "access" | "refresh" | "request" | "csrf") {
  return `b402_oauth_${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function oauthPrincipalKeyId(clientId: string, ownerId: string) {
  return `oauth_${hashOAuthValue(`${clientId}:${ownerId}`).slice(0, 48)}`;
}

export function parseOAuthScopes(value: string | null | undefined) {
  const scopes = String(value ?? "")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter((scope): scope is OAuthScope =>
      OAUTH_SCOPES.includes(scope as OAuthScope),
    );
  return [...new Set(scopes)];
}

export function serializeOAuthScopes(scopes: readonly OAuthScope[]) {
  return [...new Set(scopes)].join(" ");
}

export function apiScopesFromOAuthScopes(scopes: readonly OAuthScope[]) {
  return scopes.filter(
    (scope): scope is ApiKeyScope => scope !== OAUTH_OFFLINE_SCOPE,
  );
}

export function verifyPkce(verifier: string, challenge: string) {
  const actual = createHash("sha256")
    .update(verifier, "ascii")
    .digest("base64url");
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(challenge, "utf8");
  return actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function findOAuthAccessToken(
  rawToken: string,
  expectedResource: string,
): Promise<OAuthMcpAuth | null> {
  const [row] = await db
    .select()
    .from(oauthAccessTokensTable)
    .innerJoin(oauthClientsTable, eq(oauthClientsTable.clientId, oauthAccessTokensTable.clientId))
    .where(and(
      eq(oauthAccessTokensTable.tokenHash, hashOAuthValue(rawToken)),
      eq(oauthAccessTokensTable.resource, expectedResource),
      isNull(oauthAccessTokensTable.revokedAt),
      isNull(oauthClientsTable.revokedAt),
      gt(oauthAccessTokensTable.expiresAt, new Date()),
    ))
    .limit(1);
  const token = row?.bond402_oauth_access_tokens;
  if (!token) return null;

  await db
    .update(oauthAccessTokensTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(oauthAccessTokensTable.id, token.id));

  const scopes = apiScopesFromOAuthScopes(parseOAuthScopes(token.scopes));
  return {
    ownerId: token.ownerId,
    keyId: oauthPrincipalKeyId(token.clientId, token.ownerId),
    scopes,
    credentialType: "oauth",
    clientId: token.clientId,
    accessTokenId: token.id,
  };
}