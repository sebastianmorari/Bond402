import { and, desc, eq, sql } from "drizzle-orm";
import {
  apiChecksTable,
  apiServicesTable,
  db,
  type ApiCheckRow,
  type ApiServiceRow,
} from "@workspace/db";
import type { SecuritySignals, TargetRequestOptions, VerificationOutcome } from "./api-verifier";
import {
  calculateSecurityConfidence,
  normalizeResponseMode,
  UNKNOWN_SECURITY_SIGNALS,
} from "./api-verifier";
import {
  getDomainRelationship,
  getDomainVerificationStatus,
} from "./domain-verification-policy";
import { calculateTrustMetrics, weightedRatio } from "./trust-metrics";

export { calculateTrustMetrics, weightedRatio };

export function getTargetRequestOptions(service: ApiServiceRow): TargetRequestOptions {
  return {
    requestMethod: service.requestMethod as "GET" | "POST",
    targetAuthType: service.targetAuthType as "NONE" | "BEARER" | "API_KEY_HEADER",
    targetAuthHeaderName: service.targetAuthHeaderName,
    targetAuthSecretCiphertext: service.targetAuthSecretCiphertext,
    requestBody: service.requestBody ?? undefined,
  };
}

type ServiceDataExecutor = Pick<typeof db, "select">;

function signalState(check: ApiCheckRow | undefined) {
  if (!check) {
    return {
      https: "NOT_EVALUATED" as const,
      tls: "NOT_EVALUATED" as const,
      securityHeaders: "NOT_EVALUATED" as const,
    };
  }
  return {
    https: check.https ? ("CHECKED" as const) : ("WARNING" as const),
    tls: check.tlsStatus as "CHECKED" | "WARNING" | "UNAVAILABLE" | "NOT_EVALUATED",
    securityHeaders: check.securityHeaders.status as
      | "CHECKED"
      | "WARNING"
      | "UNAVAILABLE"
      | "NOT_EVALUATED",
  };
}

function getSecuritySignals(check: ApiCheckRow | undefined): SecuritySignals {
  return check?.securitySignals
    ? (check.securitySignals as SecuritySignals)
    : structuredClone(UNKNOWN_SECURITY_SIGNALS);
}

export function toCheckResponse(check: ApiCheckRow) {
  return {
    id: check.id,
    serviceId: check.serviceId,
    checkedAt: check.checkedAt.toISOString(),
    status: check.status as "PASS" | "FAIL" | "REVIEW",
    checkType: check.checkType as "LIVE" | "MANUAL",
    reachable: check.reachable,
    responseTimeMs: check.responseTimeMs,
    structureMatch: check.structureMatch,
    httpStatus: check.httpStatus,
    errorCode: check.errorCode,
    summary: check.summary,
    foundFields: check.foundFields,
    missingFields: check.missingFields,
    https: check.https,
    tlsStatus: check.tlsStatus,
    tlsExpiresAt: check.tlsExpiresAt?.toISOString() ?? null,
    tlsDaysRemaining: check.tlsDaysRemaining,
    securityHeaders: check.securityHeaders,
    securitySignals: getSecuritySignals(check),
    probeRegion: check.probeRegion,
  };
}

export function calculateTrust(
  checks: ApiCheckRow[],
  maxResponseTime: number,
  expectedStructure = "",
) {
  const liveChecks = checks.filter((check) => check.checkType === "LIVE");
  const metrics = calculateTrustMetrics(checks, maxResponseTime);
  if (liveChecks.length === 0) {
    return {
      score: null,
      availabilityScore: null,
      securityConfidence: structuredClone(UNKNOWN_SECURITY_SIGNALS.securityConfidence),
      explanation: "Noch keine echte Prüfung vorhanden. Starten Sie einen Live-Check.",
      metrics,
    };
  }

  const reachability = weightedRatio(liveChecks, (check) => check.reachable);
  const performance = weightedRatio(
    liveChecks,
    (check) =>
      check.reachable &&
      check.responseTimeMs > 0 &&
      check.responseTimeMs <= maxResponseTime,
  );
  const httpSuccess = weightedRatio(
    liveChecks,
    (check) =>
      check.reachable &&
      check.httpStatus !== null &&
      check.httpStatus >= 200 &&
      check.httpStatus < 300,
  );
  const schemaConfigured = expectedStructure.trim().length > 0;
  const structure = schemaConfigured
    ? weightedRatio(liveChecks, (check) => check.structureMatch)
    : 1;
  const latestLiveCheck = liveChecks[0];
  const securityConfidence = latestLiveCheck
    ? calculateSecurityConfidence(getSecuritySignals(latestLiveCheck), liveChecks.length)
    : structuredClone(UNKNOWN_SECURITY_SIGNALS.securityConfidence);
  const availabilityScore = Math.round(
    (reachability * 0.4 + httpSuccess * 0.35 + performance * 0.25) * 100,
  );
  const score = Math.round(
    reachability * 30 +
      httpSuccess * 25 +
      performance * 20 +
      (securityConfidence.score ?? 0) * 0.15 +
      structure * 10,
  );
  const overallSampleCap =
    liveChecks.length < 2 ? 60 : liveChecks.length < 3 ? 70 : liveChecks.length < 5 ? 80 : liveChecks.length < 10 ? 90 : 95;
  return {
    score: Math.min(score, overallSampleCap),
    availabilityScore,
    securityConfidence,
    metrics,
    explanation:
      `Trennung aus ${liveChecks.length} echten Prüfungen: Verfügbarkeit ${availabilityScore} %, ` +
      `Security Confidence ${securityConfidence.score ?? "unbekannt"} %, ` +
      `Gesamtvertrauen wegen begrenzter Samples maximal ${overallSampleCap} %. ` +
      "Keine Auffälligkeit gefunden ist keine Sicherheitsgarantie. " +
      `Historische Verfügbarkeit nutzt stärkere Gewichte für neue Daten: ` +
      `Erreichbarkeit ${Math.round(reachability * 100)} % (30 Punkte), ` +
      `HTTP-Erfolg ${Math.round(httpSuccess * 100)} % (25 Punkte), ` +
      `Antwortzeit ${Math.round(performance * 100)} % (20 Punkte), ` +
      `Security Confidence ${securityConfidence.score ?? 0} % (15 Punkte) und ` +
      `${schemaConfigured ? "Schema-Validierung" : "kein konfiguriertes Schema"} ` +
      `${Math.round(structure * 100)} % (10 Punkte).`,
  };
}

export async function loadChecks(
  serviceId: string,
  executor: ServiceDataExecutor = db,
) {
  return executor
    .select()
    .from(apiChecksTable)
    .where(eq(apiChecksTable.serviceId, serviceId))
    .orderBy(desc(apiChecksTable.checkedAt))
    .limit(100);
}

export async function findOwnedService(id: string, ownerId: string) {
  const [service] = await db
    .select()
    .from(apiServicesTable)
    .where(and(eq(apiServicesTable.id, id), eq(apiServicesTable.ownerId, ownerId)));
  return service;
}

export async function saveOutcome(
  serviceId: string,
  checkType: "LIVE" | "MANUAL",
  outcome: VerificationOutcome,
) {
  const [check] = await db
    .insert(apiChecksTable)
    .values({ id: crypto.randomUUID(), serviceId, checkType, ...outcome })
    .returning();
  await db.execute(sql`
    DELETE FROM ${apiChecksTable}
    WHERE ${apiChecksTable.id} IN (
      SELECT ${apiChecksTable.id}
      FROM ${apiChecksTable}
      WHERE ${apiChecksTable.serviceId} = ${serviceId}
      ORDER BY ${apiChecksTable.checkedAt} DESC
      OFFSET 100
    )
  `);
  return check;
}

export async function toServiceResponse(
  service: ApiServiceRow,
  executor: ServiceDataExecutor = db,
) {
  const checks = await loadChecks(service.id, executor);
  return buildServiceResponse(service, checks);
}

export function buildServiceResponse(
  service: ApiServiceRow,
  checks: ApiCheckRow[],
) {
  const trust = calculateTrust(checks, service.maxResponseTime, service.expectedStructure);
  const latestCheck = checks.find((check) => check.checkType === "LIVE");
  const domainRelationship = getDomainRelationship(service);
  return {
    id: service.id,
    name: service.name,
    url: service.url,
    expectedStructure: service.expectedStructure,
    responseMode: normalizeResponseMode(service.responseMode),
    maxResponseTime: service.maxResponseTime,
    requestMethod: service.requestMethod as "GET" | "POST",
    targetAuthType: service.targetAuthType as "NONE" | "BEARER" | "API_KEY_HEADER",
    targetAuthHeaderName: service.targetAuthHeaderName ?? null,
    targetAuthSecretConfigured: Boolean(service.targetAuthSecretCiphertext),
    requestBody: service.requestBody ?? null,
    visibility: service.visibility as "PRIVATE" | "LISTED",
    listedAt: service.listedAt?.toISOString() ?? null,
    createdAt: service.createdAt.toISOString(),
    trustScore: trust.score,
    trustExplanation: trust.explanation,
    availabilityScore: trust.availabilityScore,
    securityConfidence: trust.securityConfidence,
    trustMetrics: trust.metrics,
    signals: signalState(latestCheck),
    domainVerification: {
      status: getDomainVerificationStatus(service),
      verifiedAt:
        domainRelationship === "OWNED"
          ? service.domainVerifiedAt?.toISOString() ?? null
          : null,
    },
    domainRelationship,
    checks: checks.map(toCheckResponse),
  };
}

export function toPublicServiceResponse(service: ApiServiceRow, checks: ApiCheckRow[]) {
  const trust = calculateTrust(checks, service.maxResponseTime, service.expectedStructure);
  const latestCheck = checks.find((check) => check.checkType === "LIVE");
  const domainRelationship = getDomainRelationship(service);
  return {
    id: service.id,
    name: service.name,
    url: service.url,
    visibility: "LISTED" as const,
    listedAt: service.listedAt?.toISOString() ?? null,
    trustScore: trust.score,
    trustExplanation: trust.explanation,
    availabilityScore: trust.availabilityScore,
    securityConfidence: trust.securityConfidence,
    trustMetrics: trust.metrics,
    signals: signalState(latestCheck),
    domainVerification: {
      status: getDomainVerificationStatus(service),
      verifiedAt:
        domainRelationship === "OWNED"
          ? service.domainVerifiedAt?.toISOString() ?? null
          : null,
    },
    domainRelationship,
    latestStatus: latestCheck?.status as "PASS" | "FAIL" | "REVIEW" | undefined ?? null,
    latestCheckAt: latestCheck?.checkedAt.toISOString() ?? null,
    latestCheck: latestCheck
      ? {
          checkedAt: latestCheck.checkedAt.toISOString(),
          status: latestCheck.status as "PASS" | "FAIL" | "REVIEW",
          reachable: latestCheck.reachable,
          responseTimeMs: latestCheck.responseTimeMs,
          structureMatch: latestCheck.structureMatch,
          httpStatus: latestCheck.httpStatus,
          https: latestCheck.https,
          tlsStatus: latestCheck.tlsStatus,
          tlsExpiresAt: latestCheck.tlsExpiresAt?.toISOString() ?? null,
          tlsDaysRemaining: latestCheck.tlsDaysRemaining,
          securityHeaders: latestCheck.securityHeaders,
          securitySignals: getSecuritySignals(latestCheck),
          probeRegion: latestCheck.probeRegion,
        }
      : null,
    access: {
      publicCatalog: true,
      preActionRequiresDeveloperKey: false,
      liveCheckRequiresDeveloperKey: true,
    },
    links: {
      detail: `/api/public/services/${encodeURIComponent(service.id)}`,
      preActionCheck: `/api/public/services/${encodeURIComponent(service.id)}/pre-action-check`,
      privilegedPreActionCheck: `/api/developer/services/${encodeURIComponent(service.id)}/pre-action-check`,
    },
  };
}