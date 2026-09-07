import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateTrustMetrics } from "../artifacts/api-server/src/lib/service-data.ts";

const referenceNow = new Date("2026-09-07T00:00:00.000Z");
const halfLifeAgo = new Date("2026-08-24T00:00:00.000Z");
const oldestCheck = new Date("2026-08-01T00:00:00.000Z");

function makeCheck({
  id,
  checkedAt,
  reachable = true,
  responseTimeMs,
  status = "PASS",
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
    probeRegion: "fixture",
  };
}

test("Trust-Metriken liefern p95, p99, Zielwertanteil und Historienwerte transparent", () => {
  const checks = Array.from({ length: 20 }, (_, index) =>
    makeCheck({
      id: `percentile-${index}`,
      checkedAt: index === 0 ? referenceNow : oldestCheck,
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
  assert.equal(metrics.windowStartAt, oldestCheck.toISOString());
  assert.equal(metrics.latestCheckAt, referenceNow.toISOString());
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
  assert.equal(metrics.weighting.halfLifeDays, 14);
});