import { and, desc, eq, sql } from "drizzle-orm";
import {
  apiChecksTable,
  apiServicesTable,
  db,
  type ApiCheckRow,
  type ApiServiceRow,
} from "@workspace/db";
import type { VerificationOutcome } from "./api-verifier";

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
  };
}

export function calculateTrust(checks: ApiCheckRow[], maxResponseTime: number) {
  const liveChecks = checks.filter((check) => check.checkType === "LIVE");
  if (liveChecks.length === 0) {
    return {
      score: null,
      explanation: "Noch keine echte Prüfung vorhanden. Starten Sie einen Live-Check.",
    };
  }

  const ratio = (count: number) => count / liveChecks.length;
  const reachability = ratio(liveChecks.filter((check) => check.reachable).length);
  const performance = ratio(
    liveChecks.filter(
      (check) =>
        check.reachable &&
        check.responseTimeMs > 0 &&
        check.responseTimeMs <= maxResponseTime,
    ).length,
  );
  const structure = ratio(liveChecks.filter((check) => check.structureMatch).length);
  const reliability = ratio(liveChecks.filter((check) => check.status === "PASS").length);
  const score = Math.round(
    reachability * 40 + performance * 25 + structure * 25 + reliability * 10,
  );
  return {
    score,
    explanation:
      `Berechnung aus ${liveChecks.length} echten Prüfungen: ` +
      `Erreichbarkeit ${Math.round(reachability * 100)} % (40 Punkte), ` +
      `Antwortzeit ${Math.round(performance * 100)} % (25 Punkte), ` +
      `Strukturtreue ${Math.round(structure * 100)} % (25 Punkte) und ` +
      `fehlerfreie PASS-Prüfungen ${Math.round(reliability * 100)} % (10 Punkte).`,
  };
}

export async function loadChecks(serviceId: string) {
  return db
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

export async function toServiceResponse(service: ApiServiceRow) {
  const checks = await loadChecks(service.id);
  const trust = calculateTrust(checks, service.maxResponseTime);
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