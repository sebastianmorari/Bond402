import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { bond402UsersTable } from "./bond402-auth";

export const oauthClientsTable = pgTable(
  "bond402_oauth_clients",
  {
    clientId: text("client_id").primaryKey(),
    clientName: text("client_name").notNull(),
    redirectUris: text("redirect_uris").notNull(),
    grantTypes: text("grant_types").notNull().default("authorization_code,refresh_token"),
    responseTypes: text("response_types").notNull().default("code"),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method").notNull().default("none"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("bond402_oauth_clients_revoked_idx").on(table.revokedAt),
  ],
);

export const oauthAuthorizationCodesTable = pgTable(
  "bond402_oauth_authorization_codes",
  {
    id: text("id").primaryKey(),
    codeHash: text("code_hash").notNull(),
    clientId: text("client_id").notNull().references(() => oauthClientsTable.clientId, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull().references(() => bond402UsersTable.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    scopes: text("scopes").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    codeChallengeMethod: text("code_challenge_method").notNull(),
    resource: text("resource").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("bond402_oauth_codes_hash_idx").on(table.codeHash),
    index("bond402_oauth_codes_expiry_idx").on(table.expiresAt),
    index("bond402_oauth_codes_client_idx").on(table.clientId),
  ],
);

export const oauthAuthorizationRequestsTable = pgTable(
  "bond402_oauth_authorization_requests",
  {
    id: text("id").primaryKey(),
    requestHash: text("request_hash").notNull(),
    clientId: text("client_id").notNull().references(() => oauthClientsTable.clientId, { onDelete: "cascade" }),
    ownerId: text("owner_id").references(() => bond402UsersTable.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    scopes: text("scopes").notNull(),
    state: text("state").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    codeChallengeMethod: text("code_challenge_method").notNull(),
    resource: text("resource").notNull(),
    csrfHash: text("csrf_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("bond402_oauth_requests_hash_idx").on(table.requestHash),
    index("bond402_oauth_requests_expiry_idx").on(table.expiresAt),
    index("bond402_oauth_requests_client_idx").on(table.clientId),
  ],
);

export const oauthAccessTokensTable = pgTable(
  "bond402_oauth_access_tokens",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    clientId: text("client_id").notNull().references(() => oauthClientsTable.clientId, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull().references(() => bond402UsersTable.id, { onDelete: "cascade" }),
    resource: text("resource").notNull(),
    scopes: text("scopes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("bond402_oauth_access_hash_idx").on(table.tokenHash),
    index("bond402_oauth_access_expiry_idx").on(table.expiresAt),
    index("bond402_oauth_access_owner_idx").on(table.ownerId),
  ],
);

export const oauthRefreshTokensTable = pgTable(
  "bond402_oauth_refresh_tokens",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    familyId: text("family_id").notNull(),
    clientId: text("client_id").notNull().references(() => oauthClientsTable.clientId, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull().references(() => bond402UsersTable.id, { onDelete: "cascade" }),
    resource: text("resource").notNull(),
    scopes: text("scopes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedById: text("replaced_by_id"),
  },
  (table) => [
    uniqueIndex("bond402_oauth_refresh_hash_idx").on(table.tokenHash),
    index("bond402_oauth_refresh_family_idx").on(table.familyId),
    index("bond402_oauth_refresh_expiry_idx").on(table.expiresAt),
    index("bond402_oauth_refresh_owner_idx").on(table.ownerId),
  ],
);