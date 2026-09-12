import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTargetAuthPayload } from "../artifacts/bond402/src/lib/service-registration-payload.ts";

test("Keine Zielauthentifizierung sendet keine Auth-Felder", () => {
  assert.deepEqual(
    buildTargetAuthPayload({
      targetAuthType: "NONE",
      targetAuthHeaderName: "X-API-Key",
      targetAuthSecret: "",
    }),
    {},
  );
});

test("HTTP-GET ohne Auth bleibt ohne optionale leere Werte", () => {
  const payload = {
    name: "Rate limits",
    url: "https://ratesandlimits.com/api",
    responseMode: "HTTP",
    maxResponseTime: 1000,
    requestMethod: "GET",
    targetAuthType: "NONE",
    ...buildTargetAuthPayload({
      targetAuthType: "NONE",
      targetAuthHeaderName: "X-API-Key",
      targetAuthSecret: "",
    }),
  };

  assert.deepEqual(payload, {
    name: "Rate limits",
    url: "https://ratesandlimits.com/api",
    responseMode: "HTTP",
    maxResponseTime: 1000,
    requestMethod: "GET",
    targetAuthType: "NONE",
  });
});

test("Bearer-Auth sendet nur ein nichtleeres Secret", () => {
  assert.deepEqual(
    buildTargetAuthPayload({
      targetAuthType: "BEARER",
      targetAuthHeaderName: "X-API-Key",
      targetAuthSecret: "  bearer-secret  ",
    }),
    { targetAuthSecret: "bearer-secret" },
  );
});

test("API-Key-Header-Auth sendet Header und Secret nur nichtleer", () => {
  assert.deepEqual(
    buildTargetAuthPayload({
      targetAuthType: "API_KEY_HEADER",
      targetAuthHeaderName: "  X-API-Key  ",
      targetAuthSecret: "  api-key-secret  ",
    }),
    {
      targetAuthHeaderName: "X-API-Key",
      targetAuthSecret: "api-key-secret",
    },
  );
  assert.deepEqual(
    buildTargetAuthPayload({
      targetAuthType: "API_KEY_HEADER",
      targetAuthHeaderName: "  ",
      targetAuthSecret: "",
    }),
    {},
  );
});