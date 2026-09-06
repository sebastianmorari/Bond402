import type { ApiCheckRow, ApiServiceRow } from "@workspace/db";
import { calculateTrust } from "./service-data";

export type AgentDecision = "ALLOW" | "CAUTION" | "BLOCK";

export function evaluatePreAction(service: ApiServiceRow, checks: ApiCheckRow[]) {
  const liveChecks = checks.filter((check) => check.checkType === "LIVE");
  const latest = liveChecks[0];
  const trust = calculateTrust(checks, service.maxResponseTime);
  const reasons: string[] = [];
  const anomalies: string[] = [];
  let decision: AgentDecision = "ALLOW";

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
    if (ageMs > 24 * 60 * 60 * 1000) {
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
    evaluatedAt: new Date().toISOString(),
  };
}