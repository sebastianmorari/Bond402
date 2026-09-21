import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getRegisteredExecutionOperations,
  normalizeExecutionMetadata,
} from "../artifacts/api-server/src/lib/execution-metadata.ts";

const serviceUrl = "https://httpbin.org/get";

function validMetadata() {
  return {
    openapi: "3.0.3",
    info: { title: "Free HTTP reference", version: "1.0.0" },
    execution: {
      operations: [{
        method: "GET",
        path: "/get",
        parameters: [{
          name: "bond402_probe",
          type: "string",
          required: true,
          location: "query",
        }],
      }],
    },
  };
}

test("kontrollierte externe Metadaten akzeptieren nur die registrierte sichere Operation", () => {
  const normalized = normalizeExecutionMetadata(validMetadata(), serviceUrl, {
    requireOperations: true,
    requireHttps: true,
  });
  assert.equal(normalized.execution.operations[0].path, "/get");
  assert.deepEqual(normalized.execution.operations[0].parameters, [{
    name: "bond402_probe",
    type: "string",
    required: true,
    location: "query",
  }]);
  assert.deepEqual(
    getRegisteredExecutionOperations(serviceUrl, normalized, { requireOperations: true }),
    normalized.execution.operations,
  );
});

test("kontrollierte externe Metadaten blockieren Base-URL-, POST- und erfundene Parameterpfade", () => {
  assert.throws(
    () => normalizeExecutionMetadata({
      execution: { operations: [{ method: "GET", path: "/", parameters: [] }] },
    }, serviceUrl, { requireOperations: true, requireHttps: true }),
    /exakt auf den Pfad/,
  );
  assert.throws(
    () => normalizeExecutionMetadata({
      execution: { operations: [{ method: "POST", path: "/get", parameters: [] }] },
    }, serviceUrl, { requireOperations: true, requireHttps: true }),
    /GET-\/HEAD/,
  );
  assert.throws(
    () => normalizeExecutionMetadata({
      execution: {
        operations: [{
          method: "GET",
          path: "/get",
          parameters: [{ name: "id", type: "string", location: "path" }],
        }],
      },
    }, serviceUrl, { requireOperations: true, requireHttps: true }),
    /Query-Parameter/,
  );
});

test("kontrollierte externe Metadaten verlangen HTTPS und eine explizite Operation", () => {
  assert.throws(
    () => normalizeExecutionMetadata(null, "http://example.com/get", {
      requireOperations: true,
      requireHttps: true,
    }),
    /HTTPS/,
  );
  assert.throws(
    () => normalizeExecutionMetadata({ openapi: "3.0.3" }, serviceUrl, {
      requireOperations: true,
      requireHttps: true,
    }),
    /Operation/,
  );
});