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
  sourceType: text("source_type").notNull().default("MANUAL"),
  sourceProvider: text("source_provider"),
  sourceUrl: text("source_url"),
  authRequirement: text("auth_requirement").notNull().default("UNKNOWN"),
  discoveryMetadata: jsonb("discovery_metadata").$type<Record<string, unknown> | null>(),
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
  securityStatus: text("security_status").notNull().default("SANDBOX_PENDING"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  sandboxObservedAt: timestamp("sandbox_observed_at", { withTimezone: true }),
});

export type SecuritySignalsJson = {
  reachability: { status: "PASS" | "WARNING" | "FAIL" | "UNKNOWN"; summary: string };
  transport: {
    status: "PASS" | "WARNING" | "FAIL" | "UNKNOWN";
    summary: string;
    https: boolean;
    protocol: string | null;
    certificateValid: boolean | null;
    expiresAt: string | null;
    daysRemaining: number | null;
  };
  network: { status: "PASS" | "WARNING" | "FAIL" | "UNKNOWN"; summary: string };
  redirects: {
    status: "PASS" | "WARNING" | "FAIL" | "UNKNOWN";
    summary: string;
    count: number;
    crossOrigin: boolean;
    downgraded: boolean;
  };
  responseType: {
    status: "PASS" | "WARNING" | "FAIL" | "UNKNOWN";
    summary: string;
    kind: "JSON" | "TEXT" | "HTML" | "JAVASCRIPT" | "BINARY" | "DOWNLOAD" | "UNKNOWN";
    contentType: string | null;
  };
  suspiciousPayload: {
    status: "PASS" | "WARNING" | "FAIL" | "UNKNOWN";
    summary: string;
    indicators: string[];
  };
  securityHeaders: {
    status: "PASS" | "WARNING" | "FAIL" | "UNKNOWN";
    summary: string;
    evaluated: string[];
    present: string[];
    missing: string[];
  };
  reputation: { status: "UNKNOWN"; summary: string };
  rateLimit: {
    status: "PASS" | "WARNING" | "FAIL" | "UNKNOWN";
    summary: string;
    detected: boolean;
    retryAfterSeconds: number | null;
  };
  authentication: {
    status: "PASS" | "WARNING" | "FAIL" | "UNKNOWN";
    summary: string;
    required: boolean;
  };
  securityConfidence: {
    status: "PASS" | "WARNING" | "FAIL" | "UNKNOWN";
    score: number | null;
    summary: string;
  };
  threatIndicators: {
    status: "NONE_DETECTED" | "SUSPICIOUS" | "FLAGGED" | "UNKNOWN";
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    confidence: number;
    indicators: string[];
    summary: string;
  };
  historicalDrift: {
    status: "NONE" | "CHANGED" | "UNKNOWN";
    indicators: string[];
    summary: string;
  };
};

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
  securitySignals: jsonb("security_signals")
    .$type<SecuritySignalsJson>()
    .notNull()
    .default({
      reachability: { status: "UNKNOWN", summary: "Erreichbarkeit wurde nicht bewertet." },
      transport: {
        status: "UNKNOWN",
        summary: "Transport-/TLS-Signale wurden nicht bewertet.",
        https: false,
        protocol: null,
        certificateValid: null,
        expiresAt: null,
        daysRemaining: null,
      },
      network: { status: "UNKNOWN", summary: "Host- und Netzwerksicherheit wurde nicht bewertet." },
      redirects: {
        status: "UNKNOWN",
        summary: "Redirect-Verhalten wurde nicht bewertet.",
        count: 0,
        crossOrigin: false,
        downgraded: false,
      },
      responseType: {
        status: "UNKNOWN",
        summary: "Antworttyp wurde nicht bewertet.",
        kind: "UNKNOWN",
        contentType: null,
      },
      suspiciousPayload: {
        status: "UNKNOWN",
        summary: "Payload-Heuristiken wurden nicht bewertet.",
        indicators: [],
      },
      securityHeaders: {
        status: "UNKNOWN",
        summary: "Security-Header wurden nicht bewertet.",
        evaluated: [],
        present: [],
        missing: [],
      },
      reputation: {
        status: "UNKNOWN",
        summary: "Keine verlässliche kostenlose Reputation-Quelle ist konfiguriert.",
      },
      rateLimit: {
        status: "UNKNOWN",
        summary: "Rate-Limit-Hinweise wurden nicht erkannt.",
        detected: false,
        retryAfterSeconds: null,
      },
      authentication: {
        status: "UNKNOWN",
        summary: "Authentifizierungsanforderungen wurden nicht bewertet.",
        required: false,
      },
      securityConfidence: {
        status: "UNKNOWN",
        score: null,
        summary: "Security Confidence ist ohne ausreichende Beobachtungen unbekannt.",
      },
      threatIndicators: {
        status: "UNKNOWN",
        severity: "LOW",
        confidence: 0,
        indicators: [],
        summary: "Threat-Indikatoren wurden nicht bewertet.",
      },
      historicalDrift: {
        status: "UNKNOWN",
        indicators: [],
        summary: "Historische Abweichungen benötigen mehrere Bond402-Beobachtungen.",
      },
    }),
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