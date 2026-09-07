import type { ApiCheckRow } from "@workspace/db";

const TRUST_HALF_LIFE_DAYS = 14;

function freshnessWeight(checkedAt: Date, now: Date) {
  const ageDays = Math.max(0, (now.getTime() - checkedAt.getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / TRUST_HALF_LIFE_DAYS);
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(percentileValue * sorted.length) - 1),
  );
  return sorted[index] ?? null;
}

export function weightedRatio(
  checks: ApiCheckRow[],
  predicate: (check: ApiCheckRow) => boolean,
  now = new Date(),
) {
  let weightedTotal = 0;
  let weightedMatches = 0;
  for (const check of checks) {
    const weight = freshnessWeight(check.checkedAt, now);
    weightedTotal += weight;
    if (predicate(check)) weightedMatches += weight;
  }
  return weightedTotal === 0 ? 0 : weightedMatches / weightedTotal;
}

export function calculateTrustMetrics(
  checks: ApiCheckRow[],
  maxResponseTime: number,
  now = new Date(),
) {
  const liveChecks = checks.filter((check) => check.checkType === "LIVE");
  const timedChecks = liveChecks.filter(
    (check) => check.reachable && check.responseTimeMs > 0,
  );
  const responseTimes = timedChecks.map((check) => check.responseTimeMs);
  const firstCheck = liveChecks.at(-1);
  const latestCheck = liveChecks[0];
  return {
    sampleCount: liveChecks.length,
    timedSampleCount: timedChecks.length,
    uptimePercent:
      liveChecks.length === 0
        ? null
        : Math.round(weightedRatio(liveChecks, (check) => check.reachable, now) * 1000) / 10,
    averageResponseTimeMs:
      timedChecks.length === 0
        ? null
        : Math.round(
            timedChecks.reduce((sum, check) => sum + check.responseTimeMs, 0) /
              timedChecks.length,
          ),
    p95ResponseTimeMs: percentile(responseTimes, 0.95),
    p99ResponseTimeMs: percentile(responseTimes, 0.99),
    withinTargetPercent:
      timedChecks.length === 0
        ? null
        : Math.round(
            weightedRatio(timedChecks, (check) => check.responseTimeMs <= maxResponseTime, now) *
              1000,
          ) / 10,
    windowStartAt: firstCheck?.checkedAt.toISOString() ?? null,
    latestCheckAt: latestCheck?.checkedAt.toISOString() ?? null,
    weighting: {
      method: "EXPONENTIAL_DECAY" as const,
      halfLifeDays: TRUST_HALF_LIFE_DAYS,
      description: "Neuere Live-Prüfungen zählen stärker; nach 14 Tagen halbiert sich das Gewicht.",
    },
  };
}