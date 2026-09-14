import { text, timestamp, pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const publicDiscoveryRecordsTable = pgTable(
  "bond402_public_discovery_records",
  {
    id: text("id").primaryKey(),
    canonicalUrl: text("canonical_url").notNull(),
    source: text("source").notNull(),
    sourceUrl: text("source_url").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    provider: text("provider"),
    version: text("version"),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    verificationStatus: text("verification_status").notNull().default("UNVERIFIED_EXTERNAL"),
    trustStatus: text("trust_status").notNull().default("UNKNOWN"),
  },
  (table) => [
    uniqueIndex("bond402_public_discovery_records_canonical_url_idx").on(table.canonicalUrl),
  ],
);

export const insertPublicDiscoveryRecordSchema = createInsertSchema(publicDiscoveryRecordsTable).omit({
  discoveredAt: true,
  lastSeenAt: true,
});

export type PublicDiscoveryRecordRow = typeof publicDiscoveryRecordsTable.$inferSelect;
export type InsertPublicDiscoveryRecord = z.infer<typeof insertPublicDiscoveryRecordSchema>;