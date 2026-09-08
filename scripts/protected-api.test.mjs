import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptTargetSecret,
  encryptTargetSecret,
  validateTargetAuthHeaderName,
} from "../artifacts/api-server/src/lib/target-auth.ts";
import { prepareTargetRequest } from "../artifacts/api-server/src/lib/api-verifier.ts";

process.env.SESSION_SECRET ??= "protected-api-test-session-secret";

test("alte Services bleiben als GET ohne Auth und Body kompatibel", () => {
  const request = prepareTargetRequest({});
  assert.equal(request.method, "GET");
  assert.equal(request.body, undefined);
  assert.deepEqual(request.headers, {
    Accept: "application/json, text/plain;q=0.8",
    "User-Agent": "Bond402-Verification/1.0",
  });
});

test("Bearer-Secret wird nur als Ziel-Authorization-Header aufgebaut", () => {
  const secret = "bearer-secret-value";
  const request = prepareTargetRequest({
    requestMethod: "GET",
    targetAuthType: "BEARER",
    targetAuthSecretCiphertext: encryptTargetSecret(secret),
  });

  assert.equal(request.headers.Authorization, `Bearer ${secret}`);
  assert.equal(request.secretHeaderNames.has("authorization"), true);
  assert.equal(decryptTargetSecret(encryptTargetSecret(secret)), secret);
});

test("API-Key-Header nutzt einen validierten benutzerdefinierten Header", () => {
  const request = prepareTargetRequest({
    requestMethod: "GET",
    targetAuthType: "API_KEY_HEADER",
    targetAuthHeaderName: "X-API-Key",
    targetAuthSecretCiphertext: encryptTargetSecret("api-key-value"),
  });

  assert.equal(request.headers["x-api-key"], "api-key-value");
  assert.equal(request.headers.Authorization, undefined);
});

test("POST baut ausschließlich einen begrenzten JSON-Body auf", () => {
  const request = prepareTargetRequest({
    requestMethod: "POST",
    targetAuthType: "NONE",
    requestBody: { action: "preview", enabled: true },
  });

  assert.equal(request.method, "POST");
  assert.equal(request.headers["Content-Type"], "application/json");
  assert.equal(request.body, '{"action":"preview","enabled":true}');
});

test("gefährliche oder überschreibende Auth-Header werden blockiert", () => {
  for (const header of ["Host", "Cookie", "Authorization", "X-Forwarded-For", "Content-Length"]) {
    assert.throws(() => validateTargetAuthHeaderName(header), /nicht erlaubt/);
  }
});

test("verschlüsselte Secrets werden bei beschädigtem Ciphertext nicht preisgegeben", () => {
  assert.throws(
    () => decryptTargetSecret("v1.invalid.secret"),
    (error) => {
      assert.equal(error.code, "TARGET_AUTH_UNAVAILABLE");
      assert.equal(error.message.includes("invalid"), false);
      return true;
    },
  );
});