import assert from "node:assert/strict";
import { test } from "node:test";
import { createApiErrorHandler } from "../artifacts/api-server/src/lib/api-errors.ts";
import { runServiceCreationTransaction } from "../artifacts/api-server/src/lib/service-creation.ts";
import { getServiceCreationErrorResponse } from "../artifacts/api-server/src/lib/service-errors.ts";

function makeResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    headersSent: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("Transiente Datenbank-Verbindungsfehler werden als 503 mit korrelierter Request-ID ausgegeben", () => {
  const response = makeResponse();
  const logs = [];
  const handler = createApiErrorHandler({
    error(payload, message) {
      logs.push({ payload, message });
    },
  });
  const request = { id: "service-db-request-123" };
  const databaseError = Object.assign(new Error("database connection reset"), {
    code: "08006",
  });

  handler(databaseError, request, response, () => {
    throw new Error("next() darf bei einer sendbaren Fehlerantwort nicht aufgerufen werden.");
  });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    error: "Der Datenbankdienst ist vorübergehend nicht verfügbar. Bitte versuchen Sie es später erneut.",
    code: "DATABASE_UNAVAILABLE",
  });
  assert.equal(response.headers["X-Request-ID"], request.id);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].payload.requestId, request.id);
  assert.equal(logs[0].payload.databaseCode, "08006");
  assert.match(logs[0].message, /Unhandled request error/);
  assert.doesNotMatch(JSON.stringify(response.body), /bond402_api_checks|relation/);
});

test("Generische Fehler behalten INTERNAL_ERROR, erhalten aber ebenfalls eine Request-ID", () => {
  const response = makeResponse();
  const logs = [];
  const handler = createApiErrorHandler({
    error(payload) {
      logs.push(payload);
    },
  });
  const request = { id: "service-generic-request-456" };

  handler(new Error("interner Testfehler"), request, response, () => {});

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.code, "INTERNAL_ERROR");
  assert.equal(response.headers["X-Request-ID"], request.id);
  assert.equal(logs[0].requestId, request.id);
});

test("Duplikatfehler liefern einen kontrollierten Konflikt ohne Datenbankdetails", () => {
  assert.deepEqual(
    getServiceCreationErrorResponse({
      code: "23505",
      detail: "Key (id)=(secret-internal-value) already exists.",
    }),
    {
      status: 409,
      body: {
        error: "Dieser Dienst ist bereits registriert.",
        code: "SERVICE_EXISTS",
      },
    },
  );
  assert.equal(getServiceCreationErrorResponse({ code: "42P01" }), null);
});

test("Fehler beim Response-Aufbau verlassen die Transaktionsgrenze für den Rollback", async () => {
  let rolledBack = false;
  const transaction = async (callback) => {
    try {
      return await callback({});
    } catch (error) {
      rolledBack = true;
      throw error;
    }
  };

  await assert.rejects(
    () =>
      runServiceCreationTransaction(transaction, async () => {
        throw new Error("simulierter Response-Fehler");
      }),
    /simulierter Response-Fehler/,
  );
  assert.equal(rolledBack, true);
});