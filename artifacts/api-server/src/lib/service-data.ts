import { and, desc, eq, sql } from "drizzle-orm";
import {
  apiChecksTable,
  apiServicesTable,
  db,
  type ApiCheckRow,
  type ApiServiceRow,
} from "@workspace/db";
import type { VerificationOutcome } from "./api-verifier";
import { calculateTrustMetrics, weightedRatio } from "./trust-metrics";

export { calculateTrustMetrics, weightedRatio };

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
    probeRegion: check.probeRegion,
  };
}

export function calculateTrust(checks: ApiCheckRow[], maxResponseTime: number) {
  const liveChecks = checks.filter((check) => check.checkType === "LIVE");
  const metrics = calculateTrustMetrics(checks, maxResponseTime);
  if (liveChecks.length === 0) {
    return {
      score: null,
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
  const structure = weightedRatio(liveChecks, (check) => check.structureMatch);
  const reliability = weightedRatio(liveChecks, (check) => check.status === "PASS");
  const score = Math.round(
    reachability * 40 + performance * 25 + structure * 25 + reliability * 10,
  );
  return {
    score,
    metrics,
    explanation:
      `Berechnung aus ${liveChecks.length} echten Prüfungen mit stärkerem Gewicht für neue Daten: ` +
      `Erreichbarkeit ${Math.round(reachability * 100)} % (40 Punkte), ` +
      `Antwortzeit ${Math.round(performance * 100)} % (25 Punkte), ` +
      `Strukturtreue ${Math.round(structure * 100)} % (25 Punkte) und ` +
      `fehlerfreie PASS-Prüfungen ${Math.round(reliability * 100)} % (10 Punkte).`,
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
  const trust = calculateTrust(checks, service.maxResponseTime);
  const latestCheck = checks.find((check) => check.checkType === "LIVE");
  return {
    id: service.id,
    name: service.name,
    url: service.url,
    expectedStructure: service.expectedStructure,
    maxResponseTime: service.maxResponseTime,
    visibility: service.visibility as "PRIVATE" | "LISTED",
    listedAt: service.listedAt?.toISOString() ?? null,
    createdAt: service.createdAt.toISOString(),
    trustScore: trust.score,
    trustExplanation: trust.explanation,
    trustMetrics: trust.metrics,
    signals: signalState(latestCheck),
    domainVerification: {
      status: service.domainVerifiedAt
        ? ("VERIFIED" as const)
        : service.domainVerificationTokenHash
          ? ("PENDING" as const)
          : ("NOT_STARTED" as const),
      verifiedAt: service.domainVerifiedAt?.toISOString() ?? null,
    },
    checks: checks.map(toCheckResponse),
  };
}

export function toPublicServiceResponse(service: ApiServiceRow, checks: ApiCheckRow[]) {
  const trust = calculateTrust(checks, service.maxResponseTime);
  const latestCheck = checks.find((check) => check.checkType === "LIVE");
  return {
    id: service.id,
    name: service.name,
    url: service.url,
    visibility: "LISTED" as const,
    listedAt: service.listedAt?.toISOString() ?? null,
    trustScore: trust.score,
    trustExplanation: trust.explanation,
    trustMetrics: trust.metrics,
    signals: signalState(latestCheck),
    domainVerification: {
      status: service.domainVerifiedAt ? ("VERIFIED" as const) : ("NOT_EVALUATED" as const),
      verifiedAt: service.domainVerifiedAt?.toISOString() ?? null,
    },
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