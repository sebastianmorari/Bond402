import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const apiKeysTable = pgTable(
  "bond402_api_keys",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    prefix: text("prefix").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("bond402_api_keys_hash_idx").on(table.keyHash),
    index("bond402_api_keys_owner_idx").on(table.ownerId),
  ],
);

export const insertApiKeySchema = createInsertSchema(apiKeysTable).omit({
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
});

export type ApiKeyRow = typeof apiKeysTable.$inferSelect;
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;

export const apiRateLimitsTable = pgTable(
  "bond402_api_rate_limits",
  {
    identity: text("identity").notNull(),
    scope: text("scope").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.identity, table.scope] }),
  ],
);