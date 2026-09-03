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
  name: text("name").notNull(),
  url: text("url").notNull(),
  expectedStructure: text("expected_structure").notNull(),
  maxResponseTime: integer("max_response_time").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
});

export const insertApiServiceSchema = createInsertSchema(apiServicesTable).omit({
  createdAt: true,
});
export const insertApiCheckSchema = createInsertSchema(apiChecksTable).omit({
  checkedAt: true,
});

export type ApiServiceRow = typeof apiServicesTable.$inferSelect;
export type ApiCheckRow = typeof apiChecksTable.$inferSelect;
export type InsertApiService = z.infer<typeof insertApiServiceSchema>;
export type InsertApiCheck = z.infer<typeof insertApiCheckSchema>;