import type { ApiCheckRow, ApiServiceRow } from "@workspace/db";
import { calculateTrust } from "./service-data";

export type AgentDecision = "ALLOW" | "CAUTION" | "BLOCK";
export type ActionContext = "GENERAL" | "READ" | "WRITE" | "PAYMENT" | "CREDENTIAL_USE";

export const PRE_ACTION_POLICY = {
  id: "bond402-pre-action",
  version: "2026-09-06",
  maxFreshnessSeconds: 24 * 60 * 60,
} as const;

export function evaluatePreAction(
  service: ApiServiceRow,
  checks: ApiCheckRow[],
  actionContext: ActionContext = "GENERAL",
) {
  const liveChecks = checks.filter((check) => check.checkType === "LIVE");
  const latest = liveChecks[0];
  const trust = calculateTrust(checks, service.maxResponseTime);
  const reasons: string[] = [];
  const anomalies: string[] = [];
  let decision: AgentDecision = "ALLOW";
  let freshnessState: "FRESH" | "STALE" | "UNKNOWN" = "UNKNOWN";
  let freshnessAgeSeconds: number | null = null;

  const caution = (reason: string) => {
    reasons.push(reason);
    if (decision === "ALLOW") decision = "CAUTION";
  };
  const block = (reason: string) => {
    reasons.push(reason);
    decision = "BLOCK";
  };

  if (!latest) {
    block("Es liegt noch keine aktuelle Live-Prüfung für diesen Dienst vor.");
  } else {
    const ageMs = Date.now() - latest.checkedAt.getTime();
    freshnessAgeSeconds = Math.max(0, Math.floor(ageMs / 1000));
    freshnessState =
      ageMs > PRE_ACTION_POLICY.maxFreshnessSeconds * 1000 ? "STALE" : "FRESH";
    if (freshnessState === "STALE") {
      anomalies.push("STALE_CHECK");
      caution("Die letzte Live-Prüfung ist älter als 24 Stunden.");
    }
    if (!latest.reachable) block("Der Dienst war bei der letzten Prüfung nicht erreichbar.");
    if (!latest.structureMatch) block("Die Antwortstruktur entspricht nicht dem erwarteten Schema.");
    if (latest.responseTimeMs > service.maxResponseTime) {
      anomalies.push("SLOW_RESPONSE");
      caution(`Die letzte Antwortzeit von ${latest.responseTimeMs} ms überschreitet das Ziel von ${service.maxResponseTime} ms.`);
    }
    if (latest.httpStatus !== null && latest.httpStatus >= 500) {
      anomalies.push("SERVER_ERROR");
      block(`Der Dienst antwortete zuletzt mit einem Serverfehler (${latest.httpStatus}).`);
    }
    if (latest.status === "FAIL") block("Die letzte gespeicherte Live-Prüfung ist fehlgeschlagen.");
    if (latest.status === "REVIEW") caution("Die letzte Live-Prüfung benötigt eine genauere Prüfung.");
  }

  const recent = liveChecks.slice(0, 5);
  const failures = recent.filter((check) => check.status === "FAIL" || !check.reachable).length;
  const passes = recent.filter((check) => check.status === "PASS").length;
  if (failures >= 2) {
    anomalies.push("REPEATED_FAILURES");
    block(`${failures} der letzten ${recent.length} Live-Prüfungen waren auffällig oder fehlgeschlagen.`);
  } else if (failures === 1) {
    caution("Eine der letzten Live-Prüfungen war auffällig.");
  }

  if (trust.score === null) {
    caution("Es gibt noch keinen berechneten Trust Score.");
  } else if (trust.score < 40) {
    anomalies.push("LOW_TRUST_SCORE");
    block(`Der Trust Score ist mit ${trust.score}/100 zu niedrig für eine sichere Aktion.`);
  } else if (trust.score < 75) {
    anomalies.push("MEDIUM_TRUST_SCORE");
    caution(`Der Trust Score liegt mit ${trust.score}/100 nur im mittleren Bereich.`);
  }

  if (
    (actionContext === "PAYMENT" || actionContext === "CREDENTIAL_USE") &&
    decision === "ALLOW"
  ) {
    caution(
      actionContext === "PAYMENT"
        ? "Zahlungsaktionen benötigen zusätzlich eine eigene fachliche Freigabe."
        : "Aktionen mit Zugangsdaten benötigen zusätzlich eine eigene fachliche Freigabe.",
    );
  }

  if (reasons.length === 0) {
    reasons.push("Aktuelle Erreichbarkeit, Antwortzeit, Struktur und Historie sprechen für eine Nutzung.");
  }

  return {
    decision,
    reasons,
    factors: {
      trustScore: trust.score,
      latestStatus: latest?.status ?? null,
      latestCheckAt: latest?.checkedAt.toISOString() ?? null,
      latestResponseTimeMs: latest?.responseTimeMs ?? null,
      latestReachable: latest?.reachable ?? null,
      latestStructureMatch: latest?.structureMatch ?? null,
      recentLiveChecks: recent.length,
      recentPasses: passes,
      recentFailures: failures,
      anomalies,
    },
    actionContext,
    freshness: {
      state: freshnessState,
      ageSeconds: freshnessAgeSeconds,
      maxAgeSeconds: PRE_ACTION_POLICY.maxFreshnessSeconds,
    },
    policy: PRE_ACTION_POLICY,
    evaluatedAt: new Date().toISOString(),
  };
}