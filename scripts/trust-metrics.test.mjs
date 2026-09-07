import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateTrustMetrics } from "../artifacts/api-server/src/lib/trust-metrics.ts";

const referenceNow = new Date("2026-09-07T00:00:00.000Z");
const halfLifeAgo = new Date("2026-08-24T00:00:00.000Z");
const oldestCheck = new Date("2026-08-01T00:00:00.000Z");

function makeCheck({
  id,
  checkedAt,
  reachable = true,
  responseTimeMs,
  status = "PASS",
  probeRegion = "fixture",
}) {
  return {
    id,
    serviceId: "trust-metrics-fixture",
    checkedAt,
    status,
    checkType: "LIVE",
    reachable,
    responseTimeMs,
    structureMatch: true,
    httpStatus: reachable ? 200 : null,
    errorCode: reachable ? null : "TIMEOUT",
    summary: "Deterministische Trust-Metrik-Testprüfung",
    foundFields: [],
    missingFields: [],
    https: true,
    tlsStatus: "CHECKED",
    tlsExpiresAt: null,
    tlsDaysRemaining: 100,
    securityHeaders: {
      status: "CHECKED",
      evaluated: [],
      present: [],
      missing: [],
    },
    probeRegion,
  };
}

test("Trust-Metriken liefern p95, p99, Zielwertanteil und Historienwerte transparent", () => {
  const checks = Array.from({ length: 20 }, (_, index) =>
    makeCheck({
      id: `percentile-${index}`,
      checkedAt: referenceNow,
      responseTimeMs: (index + 1) * 100,
    }),
  );

  const metrics = calculateTrustMetrics(checks, 1_000, referenceNow);

  assert.equal(metrics.sampleCount, 20);
  assert.equal(metrics.timedSampleCount, 20);
  assert.equal(metrics.averageResponseTimeMs, 1_050);
  assert.equal(metrics.p95ResponseTimeMs, 1_900);
  assert.equal(metrics.p99ResponseTimeMs, 2_000);
  assert.equal(metrics.uptimePercent, 100);
  assert.equal(metrics.withinTargetPercent, 50);
  assert.equal(metrics.windowStartAt, referenceNow.toISOString());
  assert.equal(metrics.latestCheckAt, referenceNow.toISOString());
  assert.equal(metrics.regionalAggregation.state, "SINGLE_REGION");
  assert.deepEqual(metrics.regionalAggregation.regions, ["fixture"]);
  assert.equal(metrics.regionalAggregation.continuousMonitoring, false);
  assert.deepEqual(metrics.weighting, {
    method: "EXPONENTIAL_DECAY",
    halfLifeDays: 14,
    description: "Neuere Live-Prüfungen zählen stärker; nach 14 Tagen halbiert sich das Gewicht.",
  });
});

test("Neuere Live-Checks erhalten gegenüber 14 Tage alten Checks das stärkere Gewicht", () => {
  const metrics = calculateTrustMetrics(
    [
      makeCheck({
        id: "fresh-pass",
        checkedAt: referenceNow,
        responseTimeMs: 100,
        reachable: true,
      }),
      makeCheck({
        id: "old-failure",
        checkedAt: halfLifeAgo,
        responseTimeMs: 0,
        reachable: false,
        status: "FAIL",
      }),
    ],
    1_000,
    referenceNow,
  );

  assert.equal(metrics.uptimePercent, 66.7);
  assert.equal(metrics.timedSampleCount, 1);
  assert.equal(metrics.withinTargetPercent, 100);
  assert.equal(metrics.windowStartAt, halfLifeAgo.toISOString());
  assert.equal(metrics.latestCheckAt, referenceNow.toISOString());
  assert.equal(metrics.weighting.halfLifeDays, 14);
});

test("Regionale Aggregation unterscheidet die vier beobachtbaren Datenzustände", () => {
  const singleRegion = calculateTrustMetrics(
    [makeCheck({ id: "single-eu", checkedAt: referenceNow, probeRegion: "eu-west" })],
    1_000,
    referenceNow,
  );
  assert.equal(singleRegion.regionalAggregation.state, "SINGLE_REGION");
  assert.deepEqual(singleRegion.regionalAggregation.regions, ["eu-west"]);
  assert.deepEqual(singleRegion.regionalAggregation.contradictorySignals, []);

  const multipleRegions = calculateTrustMetrics(
    [
      makeCheck({ id: "multi-eu", checkedAt: referenceNow, probeRegion: "eu-west" }),
      makeCheck({ id: "multi-us", checkedAt: referenceNow, probeRegion: "us-east" }),
    ],
    1_000,
    referenceNow,
  );
  assert.equal(multipleRegions.regionalAggregation.state, "MULTIPLE_REGIONS");
  assert.deepEqual(multipleRegions.regionalAggregation.regions, ["eu-west", "us-east"]);

  const contradictoryRegions = calculateTrustMetrics(
    [
      makeCheck({ id: "contradiction-eu", checkedAt: referenceNow, probeRegion: "eu-west" }),
      makeCheck({
        id: "contradiction-us",
        checkedAt: referenceNow,
        probeRegion: "us-east",
        reachable: false,
        responseTimeMs: 0,
        status: "FAIL",
      }),
    ],
    1_000,
    referenceNow,
  );
  assert.equal(
    contradictoryRegions.regionalAggregation.state,
    "CONTRADICTORY_REGIONAL_RESULTS",
  );
  assert.deepEqual(contradictoryRegions.regionalAggregation.contradictorySignals, [
    "status",
    "reachability",
  ]);

  const insufficientData = calculateTrustMetrics(
    [makeCheck({ id: "missing-region", checkedAt: referenceNow, probeRegion: "  " })],
    1_000,
    referenceNow,
  );
  assert.equal(
    insufficientData.regionalAggregation.state,
    "INSUFFICIENT_REGIONAL_DATA",
  );
  assert.equal(insufficientData.regionalAggregation.regionCount, 0);
  assert.equal(insufficientData.regionalAggregation.unassignedLiveCheckCount, 1);
  assert.equal(insufficientData.regionalAggregation.continuousMonitoring, false);
});