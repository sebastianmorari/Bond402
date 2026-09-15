import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const executionPlansTable = pgTable(
  "bond402_execution_plans",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    apiKeyId: text("api_key_id").notNull(),
    serviceId: text("service_id").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    parametersDigest: text("parameters_digest").notNull(),
    serviceConfigDigest: text("service_config_digest").notNull(),
    status: text("status").notNull().default("READY"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("bond402_execution_plans_owner_idx").on(table.ownerId, table.createdAt),
    index("bond402_execution_plans_service_idx").on(table.serviceId, table.createdAt),
  ],
);

export const executionAuditTable = pgTable(
  "bond402_execution_audit",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    planId: text("plan_id"),
    ownerId: text("owner_id").notNull(),
    serviceId: text("service_id").notNull(),
    operationMethod: text("operation_method").notNull(),
    operationPath: text("operation_path").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    status: text("status").notNull(),
    code: text("code").notNull(),
    providerHttpStatus: integer("provider_http_status"),
    retryable: text("retryable").notNull(),
    retryAfterSeconds: integer("retry_after_seconds"),
    quotaUsed: integer("quota_used"),
    parametersDigest: text("parameters_digest").notNull(),
    outputDigest: text("output_digest"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("bond402_execution_audit_owner_idx").on(table.ownerId, table.createdAt),
    index("bond402_execution_audit_service_idx").on(table.serviceId, table.createdAt),
    index("bond402_execution_audit_request_idx").on(table.requestId),
  ],
);

export type ExecutionPlanRow = typeof executionPlansTable.$inferSelect;
export type ExecutionAuditRow = typeof executionAuditTable.$inferSelect;