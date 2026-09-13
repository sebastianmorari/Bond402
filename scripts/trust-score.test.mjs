import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateTrust } from "../artifacts/api-server/src/lib/service-data.ts";

function makeCheck(overrides = {}) {
  return {
    id: "trust-score-fixture",
    serviceId: "trust-score-service",
    checkedAt: new Date("2026-09-13T10:00:00.000Z"),
    status: "PASS",
    checkType: "LIVE",
    reachable: true,
    responseTimeMs: 120,
    structureMatch: true,
    httpStatus: 200,
    errorCode: null,
    summary: "Fixture",
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
    ...overrides,
  };
}

test("Ein gültiger JSON-Endpunkt ohne Schema erhält einen vollständigen Schemaanteil", () => {
  const trust = calculateTrust([makeCheck()], 1000, "");

  assert.equal(trust.score, 100);
  assert.match(trust.explanation, /kein konfiguriertes Schema 100 % \(10 Punkte\)/);
});

test("Ein expliziter Schemafehler senkt nur den Schemaanteil des Trust Scores", () => {
  const trust = calculateTrust(
    [makeCheck({ status: "FAIL", structureMatch: false, missingFields: ["status"] })],
    1000,
    "status",
  );

  assert.equal(trust.score, 90);
  assert.match(trust.explanation, /Schema-Validierung 0 % \(10 Punkte\)/);
});