import type { ApiCheckRow } from "@workspace/db";

const TRUST_HALF_LIFE_DAYS = 14;

export const REGIONAL_AGGREGATION_STATES = {
  SINGLE_REGION: "SINGLE_REGION",
  MULTIPLE_REGIONS: "MULTIPLE_REGIONS",
  CONTRADICTORY_REGIONAL_RESULTS: "CONTRADICTORY_REGIONAL_RESULTS",
  INSUFFICIENT_REGIONAL_DATA: "INSUFFICIENT_REGIONAL_DATA",
} as const;

export type RegionalAggregationState =
  (typeof REGIONAL_AGGREGATION_STATES)[keyof typeof REGIONAL_AGGREGATION_STATES];

type ContradictorySignal = "status" | "reachability" | "https" | "tls" | "securityHeaders";

export type RegionalAggregation = {
  state: RegionalAggregationState;
  regionCount: number;
  regions: string[];
  liveCheckCount: number;
  evaluatedCheckCount: number;
  unassignedLiveCheckCount: number;
  regionalResults: Array<{
    region: string;
    sampleCount: number;
    latestCheckAt: string;
    latestStatus: ApiCheckRow["status"];
    latestReachable: boolean;
  }>;
  contradictorySignals: ContradictorySignal[];
  observationBasis: "STORED_LIVE_CHECKS";
  continuousMonitoring: false;
  description: string;
};

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

function latestByCheckedAt(checks: ApiCheckRow[]) {
  return checks.reduce<ApiCheckRow | undefined>(
    (latest, check) =>
      !latest || check.checkedAt.getTime() > latest.checkedAt.getTime() ? check : latest,
    undefined,
  );
}

function regionalOutcome(check: ApiCheckRow) {
  return {
    status: check.status,
    reachable: check.reachable,
    https: check.https,
    tls: check.tlsStatus,
    securityHeaders: check.securityHeaders.status,
  };
}

export function calculateRegionalAggregation(checks: ApiCheckRow[]): RegionalAggregation {
  const liveChecks = checks.filter((check) => check.checkType === "LIVE");
  const byRegion = new Map<string, ApiCheckRow[]>();
  let unassignedLiveCheckCount = 0;

  for (const check of liveChecks) {
    const region = check.probeRegion.trim();
    if (!region) {
      unassignedLiveCheckCount += 1;
      continue;
    }
    const regionChecks = byRegion.get(region) ?? [];
    regionChecks.push(check);
    byRegion.set(region, regionChecks);
  }

  const regions = [...byRegion.keys()].sort((a, b) => a.localeCompare(b));
  const regionalResults = regions.map((region) => {
    const regionChecks = byRegion.get(region) ?? [];
    const latest = latestByCheckedAt(regionChecks);
    return {
      region,
      sampleCount: regionChecks.length,
      latestCheckAt: latest?.checkedAt.toISOString() ?? "",
      latestStatus: latest?.status ?? "REVIEW",
      latestReachable: latest?.reachable ?? false,
    };
  });

  const latestRegionalChecks = regions
    .map((region) => latestByCheckedAt(byRegion.get(region) ?? []))
    .filter((check): check is ApiCheckRow => Boolean(check));
  const contradictorySignals = ([
    "status",
    "reachable",
    "https",
    "tls",
    "securityHeaders",
  ] as const).filter((signal) => {
    const values = new Set(latestRegionalChecks.map((check) => regionalOutcome(check)[signal]));
    return values.size > 1;
  }).map((signal) => (signal === "reachable" ? "reachability" : signal));

  let state: RegionalAggregationState;
  if (liveChecks.length === 0 || regions.length === 0) {
    state = REGIONAL_AGGREGATION_STATES.INSUFFICIENT_REGIONAL_DATA;
  } else if (regions.length === 1) {
    state = REGIONAL_AGGREGATION_STATES.SINGLE_REGION;
  } else if (contradictorySignals.length > 0) {
    state = REGIONAL_AGGREGATION_STATES.CONTRADICTORY_REGIONAL_RESULTS;
  } else {
    state = REGIONAL_AGGREGATION_STATES.MULTIPLE_REGIONS;
  }

  const descriptions: Record<RegionalAggregationState, string> = {
    SINGLE_REGION:
      "Eine Prüfregion ist in den gespeicherten Bond402-Livechecks beobachtet. Dies ist keine kontinuierliche Mehrregionen-Überwachung.",
    MULTIPLE_REGIONS:
      "Mehrere Prüfregionen sind in den gespeicherten Bond402-Livechecks beobachtet; die letzten regionalen Ergebnisse widersprechen sich nicht. Dies ist keine kontinuierliche Mehrregionen-Überwachung.",
    CONTRADICTORY_REGIONAL_RESULTS:
      "Die letzten gespeicherten Bond402-Livechecks zeigen widersprüchliche Ergebnisse zwischen Prüfregionen. Dies ist keine kontinuierliche Mehrregionen-Überwachung.",
    INSUFFICIENT_REGIONAL_DATA:
      "Es liegen keine ausreichenden gespeicherten Bond402-Livechecks mit auswertbarer Prüfregion vor. Dies ist keine kontinuierliche Mehrregionen-Überwachung.",
  };

  return {
    state,
    regionCount: regions.length,
    regions,
    liveCheckCount: liveChecks.length,
    evaluatedCheckCount: liveChecks.length - unassignedLiveCheckCount,
    unassignedLiveCheckCount,
    regionalResults,
    contradictorySignals,
    observationBasis: "STORED_LIVE_CHECKS",
    continuousMonitoring: false,
    description: descriptions[state],
  };
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
    regionalAggregation: calculateRegionalAggregation(liveChecks),
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