import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const apiServicesTable = pgTable("bond402_api_services", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("legacy-unowned"),
  name: text("name").notNull(),
  url: text("url").notNull(),
  expectedStructure: text("expected_structure").notNull(),
  responseMode: text("response_mode").notNull().default("JSON"),
  maxResponseTime: integer("max_response_time").notNull(),
  visibility: text("visibility").notNull().default("PRIVATE"),
  requestMethod: text("request_method").notNull().default("GET"),
  targetAuthType: text("target_auth_type").notNull().default("NONE"),
  targetAuthHeaderName: text("target_auth_header_name"),
  targetAuthSecretCiphertext: text("target_auth_secret_ciphertext"),
  requestBody: jsonb("request_body").$type<Record<string, unknown> | unknown[] | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  listedAt: timestamp("listed_at", { withTimezone: true }),
  domainVerificationTokenHash: text("domain_verification_token_hash"),
  domainVerificationIssuedAt: timestamp("domain_verification_issued_at", { withTimezone: true }),
  domainVerifiedAt: timestamp("domain_verified_at", { withTimezone: true }),
  domainRelationship: text("domain_relationship").notNull().default("THIRD_PARTY"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const apiChecksTable = pgTable("bond402_api_checks", {
  id: text("id").primaryKey(),
  serviceId: text("service_id")
    .notNull()
    .references(() => apiServicesTable.id, { onDelete: "cascade" }),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull(),
  checkType: text("check_type").notNull(),
  reachable: boolean("reachable").notNull(),
  responseTimeMs: integer("response_time_ms").notNull(),
  structureMatch: boolean("structure_match").notNull(),
  httpStatus: integer("http_status"),
  errorCode: text("error_code"),
  summary: text("summary").notNull(),
  foundFields: jsonb("found_fields").$type<string[]>().notNull().default([]),
  missingFields: jsonb("missing_fields").$type<string[]>().notNull().default([]),
  https: boolean("https").notNull().default(false),
  tlsStatus: text("tls_status").notNull().default("NOT_EVALUATED"),
  tlsExpiresAt: timestamp("tls_expires_at", { withTimezone: true }),
  tlsDaysRemaining: integer("tls_days_remaining"),
  securityHeaders: jsonb("security_headers")
    .$type<{
      status: string;
      evaluated: string[];
      present: string[];
      missing: string[];
    }>()
    .notNull()
    .default({ status: "NOT_EVALUATED", evaluated: [], present: [], missing: [] }),
  probeRegion: text("probe_region").notNull().default("default"),
});

export const insertApiServiceSchema = createInsertSchema(apiServicesTable).omit({
  createdAt: true,
  updatedAt: true,
});
export const insertApiCheckSchema = createInsertSchema(apiChecksTable).omit({
  checkedAt: true,
});

export type ApiServiceRow = typeof apiServicesTable.$inferSelect;
export type ApiCheckRow = typeof apiChecksTable.$inferSelect;
export type InsertApiService = z.infer<typeof insertApiServiceSchema>;
export type InsertApiCheck = z.infer<typeof insertApiCheckSchema>;