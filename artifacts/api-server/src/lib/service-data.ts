import { and, desc, eq, sql } from "drizzle-orm";
import {
  apiChecksTable,
  apiServicesTable,
  bond402SecurityObservationsTable,
  bond402ThreatIndicatorsTable,
  db,
  type ApiCheckRow,
  type ApiServiceRow,
} from "@workspace/db";
import type {
  SecurityObservation,
  SecuritySignals,
  TargetRequestOptions,
  VerificationOutcome,
} from "./api-verifier";
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
    requestMethod: service.requestMethod as "GET" | "HEAD" | "POST",
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
  if (!check?.securitySignals) return structuredClone(UNKNOWN_SECURITY_SIGNALS);
  const stored = check.securitySignals as Partial<SecuritySignals>;
  return {
    ...structuredClone(UNKNOWN_SECURITY_SIGNALS),
    ...stored,
    threatIndicators: stored.threatIndicators ?? structuredClone(UNKNOWN_SECURITY_SIGNALS.threatIndicators),
    historicalDrift: stored.historicalDrift ?? structuredClone(UNKNOWN_SECURITY_SIGNALS.historicalDrift),
  };
}

function isQualifyingFirstSeenCheck(check: ApiCheckRow) {
  if (
    check.checkType !== "LIVE" ||
    !check.reachable ||
    check.httpStatus === null ||
    check.httpStatus < 200 ||
    check.httpStatus >= 300 ||
    !check.securitySignals
  ) {
    return false;
  }

  const signals = getSecuritySignals(check);
  return (
    signals.network.status !== "FAIL" &&
    signals.transport.status !== "FAIL" &&
    signals.threatIndicators.status === "NONE_DETECTED" &&
    signals.historicalDrift.status !== "CHANGED" &&
    signals.securityConfidence.status !== "FAIL"
  );
}

export function countQualifyingFirstSeenChecks(checks: ApiCheckRow[]) {
  return checks.filter(isQualifyingFirstSeenCheck).length;
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

function applySecurityStatusCap(
  score: number | null,
  securityStatus: string,
): number | null {
  if (score === null) return null;
  if (securityStatus === "FLAGGED") return 0;
  if (securityStatus === "SUSPICIOUS") return Math.min(score, 35);
  if (securityStatus === "SANDBOX_PENDING") return Math.min(score, 40);
  if (securityStatus === "SANDBOXED_OBSERVED") return Math.min(score, 60);
  return score;
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
  const observation = outcome.securityObservation;
  const previousObservation = observation
    ? (
        await db
          .select()
          .from(bond402SecurityObservationsTable)
          .where(eq(bond402SecurityObservationsTable.serviceId, serviceId))
          .orderBy(desc(bond402SecurityObservationsTable.observedAt))
          .limit(1)
      )[0]
    : undefined;
  const securitySignals = withHistoricalDrift(outcome.securitySignals, previousObservation, observation);
  const { securityObservation: _securityObservation, ...checkOutcome } = outcome;
  const [check] = await db
    .insert(apiChecksTable)
    .values({ id: crypto.randomUUID(), serviceId, checkType, ...checkOutcome, securitySignals })
    .returning();
  if (observation) {
    await db.insert(bond402SecurityObservationsTable).values({
      id: crypto.randomUUID(),
      serviceId,
      status: securitySignals.threatIndicators.status,
      ...observation,
      indicators: securitySignals.threatIndicators.indicators,
    });
    if (securitySignals.threatIndicators.indicators.length > 0) {
      await db.insert(bond402ThreatIndicatorsTable).values(
        securitySignals.threatIndicators.indicators.map((indicator) => ({
          id: crypto.randomUUID(),
          indicatorType: "PAYLOAD_HEURISTIC",
          normalizedValue: indicator,
          verdict: securitySignals.threatIndicators.status,
          severity: securitySignals.threatIndicators.severity,
          confidence: String(securitySignals.threatIndicators.confidence),
          source: "BOND402_HEURISTICS",
          metadata: { serviceId },
        })),
      );
    }
  }
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
  if (checkType === "LIVE") {
    const recentChecks = await loadChecks(serviceId);
    const liveChecks = recentChecks.filter((item) => item.checkType === "LIVE");
    const qualifyingChecks = countQualifyingFirstSeenChecks(recentChecks);
    const hasFlag = liveChecks.some((item) => {
      const signals = getSecuritySignals(item);
      return signals.threatIndicators.status === "FLAGGED";
    });
    const hasSuspicion = liveChecks.some((item) => {
      const signals = getSecuritySignals(item);
      return signals.threatIndicators.status === "SUSPICIOUS" || signals.historicalDrift.status === "CHANGED";
    });
    const nextSecurityStatus = hasFlag
      ? "FLAGGED"
      : hasSuspicion
        ? "SUSPICIOUS"
        : qualifyingChecks >= 3
          ? "VERIFIED_LOW_RISK"
          : liveChecks.some((item) => item.reachable && item.securitySignals)
            ? "SANDBOXED_OBSERVED"
            : "SANDBOX_PENDING";
    const [service] = await db
      .select({ sandboxObservedAt: apiServicesTable.sandboxObservedAt })
      .from(apiServicesTable)
      .where(eq(apiServicesTable.id, serviceId))
      .limit(1);
    await db
      .update(apiServicesTable)
      .set({
        securityStatus: nextSecurityStatus,
        sandboxObservedAt:
          service?.sandboxObservedAt ??
          (liveChecks.some((item) => item.reachable && item.securitySignals) ? new Date() : null),
      })
      .where(eq(apiServicesTable.id, serviceId));
  }
  return check;
}

function withHistoricalDrift(
  signals: SecuritySignals,
  previous: {
    responseFingerprint: string;
    responseKind: string;
    responseSizeBucket: string;
    headerFingerprint: string;
    redirectTargets: string[];
    tlsFingerprint: string;
  } | undefined,
  current: SecurityObservation | undefined,
): SecuritySignals {
  if (!previous || !current) return signals;
  const indicators: string[] = [];
  if (previous.responseFingerprint !== current.responseFingerprint) indicators.push("RESPONSE_STRUCTURE_CHANGED");
  if (previous.responseKind !== current.responseKind) indicators.push("RESPONSE_KIND_CHANGED");
  if (previous.headerFingerprint !== current.headerFingerprint) indicators.push("SECURITY_HEADERS_CHANGED");
  if (previous.tlsFingerprint !== current.tlsFingerprint) indicators.push("TLS_FINGERPRINT_CHANGED");
  if (previous.redirectTargets.join("|") !== current.redirectTargets.join("|")) indicators.push("REDIRECT_TARGETS_CHANGED");
  return {
    ...signals,
    historicalDrift: {
      status: indicators.length > 0 ? "CHANGED" : "NONE",
      indicators,
      summary:
        indicators.length > 0
          ? `Historische Abweichung erkannt: ${indicators.join(", ")}.`
          : "Die beobachteten Response- und Transportmerkmale entsprechen dem letzten Beobachtungsfingerprint.",
    },
  };
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
    sourceType: service.sourceType as "MANUAL" | "EXTERNAL_DISCOVERY",
    sourceProvider: service.sourceProvider,
    sourceUrl: service.sourceUrl,
    authRequirement: service.authRequirement as "REQUIRED" | "NOT_REQUIRED" | "NOT_DECLARED" | "UNKNOWN",
    discoveryMetadata: service.discoveryMetadata ?? null,
    expectedStructure: service.expectedStructure,
    responseMode: normalizeResponseMode(service.responseMode),
    maxResponseTime: service.maxResponseTime,
    requestMethod: service.requestMethod as "GET" | "HEAD" | "POST",
    targetAuthType: service.targetAuthType as "NONE" | "BEARER" | "API_KEY_HEADER",
    targetAuthHeaderName: service.targetAuthHeaderName ?? null,
    targetAuthSecretConfigured: Boolean(service.targetAuthSecretCiphertext),
    requestBody: service.requestBody ?? null,
    visibility: service.visibility as "PRIVATE" | "LISTED",
    listedAt: service.listedAt?.toISOString() ?? null,
    createdAt: service.createdAt.toISOString(),
     trustScore: applySecurityStatusCap(trust.score, service.securityStatus),
    trustExplanation: trust.explanation,
    availabilityScore: trust.availabilityScore,
    securityConfidence: trust.securityConfidence,
    securityStatus: service.securityStatus,
    firstSeenAt: service.firstSeenAt.toISOString(),
    sandboxObservedAt: service.sandboxObservedAt?.toISOString() ?? null,
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
     trustScore: applySecurityStatusCap(trust.score, service.securityStatus),
    trustExplanation: trust.explanation,
    availabilityScore: trust.availabilityScore,
    securityConfidence: trust.securityConfidence,
    securityStatus: service.securityStatus,
    firstSeenAt: service.firstSeenAt.toISOString(),
    sandboxObservedAt: service.sandboxObservedAt?.toISOString() ?? null,
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