import assert from "node:assert/strict";
import { test } from "node:test";
import { runLiveVerification, runManualVerification } from "../artifacts/api-server/src/lib/api-verifier.ts";

const tls = {
  status: "NOT_EVALUATED",
  expiresAt: null,
  daysRemaining: null,
};

function fakeFetcher(body, status = 200, elapsedMs = 120, headers = { "content-type": "text/html" }) {
  return async () => ({
    body,
    status,
    elapsedMs,
    headers,
    location: undefined,
    tls,
  });
}

test("HTTP-Modus akzeptiert eine erfolgreiche HTML-Antwort ohne JSON-Parsing", async () => {
  const result = await runLiveVerification(
    "https://service.example.test/page",
    "",
    1000,
    {},
    "HTTP",
    fakeFetcher("<html><body>OK</body></html>"),
  );

  assert.equal(result.status, "PASS");
  assert.equal(result.structureMatch, true);
  assert.equal(result.errorCode, null);
  assert.deepEqual(result.missingFields, []);
});

test("JSON-Modus akzeptiert gültiges JSON mit der erwarteten Struktur", async () => {
  const result = await runLiveVerification(
    "https://service.example.test/data",
    '{"status":"ok"}',
    1000,
    {},
    "JSON",
    fakeFetcher('{"status":"ok"}', 200, 120, { "content-type": "application/json" }),
  );

  assert.equal(result.status, "PASS");
  assert.equal(result.structureMatch, true);
  assert.deepEqual(result.foundFields, ["status"]);
});

test("JSON-Modus meldet ungültiges JSON weiterhin als INVALID_JSON", async () => {
  const result = await runLiveVerification(
    "https://service.example.test/data",
    '{"status":"ok"}',
    1000,
    {},
    "JSON",
    fakeFetcher("<html>not json</html>"),
  );

  assert.equal(result.status, "FAIL");
  assert.equal(result.errorCode, "INVALID_JSON");
  assert.equal(result.structureMatch, false);
});

test("Manuelle JSON-Prüfung bleibt im HTTP-Modus ohne Inhalts-Parsing unkritisch", () => {
  const result = runManualVerification("", "<html>OK</html>", "HTTP");

  assert.equal(result.status, "PASS");
  assert.equal(result.structureMatch, true);
  assert.equal(result.errorCode, null);
});