import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { apiServicesTable } from "./bond402";

export const bond402ThreatIndicatorsTable = pgTable("bond402_threat_indicators", {
  id: text("id").primaryKey(),
  indicatorType: text("indicator_type").notNull(),
  normalizedValue: text("normalized_value").notNull(),
  verdict: text("verdict").notNull(),
  severity: text("severity").notNull(),
  confidence: text("confidence").notNull(),
  source: text("source").notNull(),
  sourceCheckedAt: timestamp("source_checked_at", { withTimezone: true }).notNull().defaultNow(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
});

export const bond402SecurityObservationsTable = pgTable("bond402_security_observations", {
  id: text("id").primaryKey(),
  serviceId: text("service_id")
    .notNull()
    .references(() => apiServicesTable.id, { onDelete: "cascade" }),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull(),
  responseFingerprint: text("response_fingerprint").notNull(),
  responseKind: text("response_kind").notNull(),
  responseSizeBucket: text("response_size_bucket").notNull(),
  headerFingerprint: text("header_fingerprint").notNull(),
  redirectTargets: jsonb("redirect_targets").$type<string[]>().notNull().default([]),
  tlsFingerprint: text("tls_fingerprint").notNull(),
  latencyBucket: text("latency_bucket").notNull(),
  indicators: jsonb("indicators").$type<string[]>().notNull().default([]),
});

export const insertThreatIndicatorSchema = createInsertSchema(bond402ThreatIndicatorsTable);
export const insertSecurityObservationSchema = createInsertSchema(bond402SecurityObservationsTable);

export type ThreatIndicatorRow = typeof bond402ThreatIndicatorsTable.$inferSelect;
export type SecurityObservationRow = typeof bond402SecurityObservationsTable.$inferSelect;