import assert from "node:assert/strict";
import { test } from "node:test";
import { createApiErrorHandler } from "../artifacts/api-server/src/lib/api-errors.ts";
import { withTransientDatabaseReadRetry } from "../artifacts/api-server/src/lib/database-resilience.ts";
import { runServiceCreationTransaction } from "../artifacts/api-server/src/lib/service-creation.ts";

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

function codedError(code) {
  return Object.assign(new Error(code), { code });
}

test("transienter DB-Lesefehler wird begrenzt wiederholt und kann erfolgreich enden", async () => {
  let attempts = 0;
  const delays = [];

  const result = await withTransientDatabaseReadRetry(
    async () => {
      attempts += 1;
      if (attempts === 1) throw codedError("ECONNRESET");
      return "ok";
    },
    {
      sleep: async (delayMs) => delays.push(delayMs),
      random: () => 0.5,
    },
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [40]);
});

test("endgültiger echter DB-Ausfall endet nach der Retry-Grenze", async () => {
  let attempts = 0;
  const delays = [];

  await assert.rejects(
    () =>
      withTransientDatabaseReadRetry(
        async () => {
          attempts += 1;
          throw codedError("08006");
        },
        {
          sleep: async (delayMs) => delays.push(delayMs),
          random: () => 0.5,
        },
      ),
    (error) => error.code === "08006",
  );

  assert.equal(attempts, 3);
  assert.deepEqual(delays, [40, 80]);
});

test("normale SQL-, Constraint- und Schemafehler liefern kein DATABASE_UNAVAILABLE", () => {
  for (const code of ["22P02", "23505", "42P01", "40001"]) {
    const response = makeResponse();
    const handler = createApiErrorHandler({ error() {} });

    handler(codedError(code), { id: `request-${code}` }, response, () => {});

    assert.equal(response.statusCode, 500);
    assert.equal(response.body.code, "INTERNAL_ERROR");
  }
});

test("Schreibtransaktionen werden nicht über den Read-Retry wiederholt", async () => {
  let transactionCalls = 0;

  await assert.rejects(
    () =>
      runServiceCreationTransaction(
        async (callback) => {
          transactionCalls += 1;
          return callback({});
        },
        async () => {
          throw codedError("ECONNRESET");
        },
      ),
    (error) => error.code === "ECONNRESET",
  );

  assert.equal(transactionCalls, 1);
});