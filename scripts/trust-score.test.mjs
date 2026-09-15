import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateTrust,
  countQualifyingFirstSeenChecks,
} from "../artifacts/api-server/src/lib/service-data.ts";

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

test("Ein gültiger JSON-Endpunkt ohne Schema erhält den Schemaanteil, aber keinen überhöhten Ein-Sample-Trust", () => {
  const trust = calculateTrust([makeCheck()], 1000, "");

  assert.ok(trust.score <= 60);
  assert.ok(trust.securityConfidence.score <= 60);
  assert.match(trust.explanation, /kein konfiguriertes Schema 100 % \(10 Punkte\)/);
});

test("Ein expliziter Schemafehler bleibt sichtbar und der Ein-Sample-Deckel bleibt aktiv", () => {
  const trust = calculateTrust(
    [makeCheck({ status: "FAIL", structureMatch: false, missingFields: ["status"] })],
    1000,
    "status",
  );

  assert.ok(trust.score <= 60);
  assert.match(trust.explanation, /Schema-Validierung 0 % \(10 Punkte\)/);
});

function securitySignals(overrides = {}) {
  return {
    network: { status: "PASS" },
    transport: { status: "PASS" },
    threatIndicators: { status: "NONE_DETECTED" },
    historicalDrift: { status: "NONE" },
    securityConfidence: { status: "WARNING" },
    ...overrides,
  };
}

test("First-Seen-Zählung ignoriert nicht erreichbare oder nicht erfolgreiche Live-Checks", () => {
  const base = makeCheck({ securitySignals: securitySignals() });
  assert.equal(
    countQualifyingFirstSeenChecks([
      base,
      base,
      base,
      makeCheck({ reachable: false, httpStatus: null, securitySignals: undefined }),
      makeCheck({ httpStatus: 500, securitySignals: securitySignals() }),
    ]),
    3,
  );
});

test("First-Seen-Zählung ignoriert verdächtige oder historisch veränderte Antworten", () => {
  const base = makeCheck({ securitySignals: securitySignals() });
  assert.equal(
    countQualifyingFirstSeenChecks([
      base,
      makeCheck({
        securitySignals: securitySignals({
          threatIndicators: { status: "SUSPICIOUS" },
        }),
      }),
      makeCheck({
        securitySignals: securitySignals({
          historicalDrift: { status: "CHANGED" },
        }),
      }),
    ]),
    1,
  );
});