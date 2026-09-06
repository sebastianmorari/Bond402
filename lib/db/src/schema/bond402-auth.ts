import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const bond402UsersTable = pgTable(
  "bond402_users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    emailVerificationRequired: boolean("email_verification_required").notNull().default(false),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("bond402_users_email_idx").on(table.email)],
);

export const bond402SessionsTable = pgTable(
  "bond402_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("bond402_sessions_token_hash_idx").on(table.tokenHash),
    index("bond402_sessions_user_idx").on(table.userId),
    index("bond402_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const bond402AuthTokensTable = pgTable(
  "bond402_auth_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    purpose: text("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("bond402_auth_tokens_hash_idx").on(table.tokenHash),
    index("bond402_auth_tokens_user_purpose_idx").on(table.userId, table.purpose),
    index("bond402_auth_tokens_expiry_idx").on(table.expiresAt),
  ],
);

export type Bond402UserRow = typeof bond402UsersTable.$inferSelect;