import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseExternalSpecification,
  type ExternalApiDetail,
} from "../artifacts/api-server/src/lib/public-external-detail";

function record(id: string) {
  return {
    id: `external:apis-guru:${id}:1.0.0`,
    provider: `${id}.example`,
    version: "1.0.0",
    name: "External API",
    description: "Source description",
    categories: [],
    openapiVersion: "3.0.0",
    updatedAt: "2026-09-12T11:00:00.000Z",
    specificationUrl: `https://api.apis.guru/v2/specs/${id}/1.0.0/openapi.json`,
    sourceRecordUrl: `https://api.apis.guru/v2/specs/${id}/1.0.0.json`,
  };
}

test("external details classify explicit public read endpoints without guessing", () => {
  const parsed = parseExternalSpecification(
    record("safe-detail"),
    JSON.stringify({
      openapi: "3.0.3",
      info: { title: "Safe Detail API", description: "Read-only status" },
      servers: [{ url: "https://safe-detail.example.test/v1" }],
      security: [],
      paths: {
        "/status": {
          get: { operationId: "getStatus", summary: "Read status", security: [] },
        },
        "/users/{id}": {
          get: { operationId: "getUser" },
        },
        "/mutate": {
          post: { operationId: "mutate", security: [] },
        },
      },
    }),
    "application/json",
  );

  const detail: ExternalApiDetail = parsed.detail;
  assert.equal(detail.kind, "EXTERNAL_DISCOVERY_DETAIL");
  assert.equal(detail.verification.status, "UNVERIFIED_EXTERNAL");
  assert.equal(detail.specification.status, "PARSED");
  assert.equal(detail.specification.auth.status, "NOT_REQUIRED");
  assert.equal(detail.specification.endpoints.length, 3);
  assert.equal(
    detail.specification.endpoints.find((endpoint) => endpoint.path === "/status")?.safeToProbe,
    true,
  );
  assert.deepEqual(parsed.candidate, {
    method: "GET",
    path: "/status",
    url: "https://safe-detail.example.test/v1/status",
  });
  assert.equal(detail.specification.endpoints.some((endpoint) => endpoint.path.includes("{id}")), true);
  assert.equal(
    detail.specification.endpoints.find((endpoint) => endpoint.path.includes("{id}"))?.safeToProbe,
    false,
  );
  assert.equal(detail.specification.endpoints.some((endpoint) => endpoint.method === "POST" && endpoint.safeToProbe), false);
});

test("external details report auth requirements and never invent credentials", () => {
  const parsed = parseExternalSpecification(
    record("auth-detail"),
    `openapi: 3.0.3
info:
  title: Auth Detail API
servers:
  - url: https://auth-detail.example.test
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
security:
  - bearerAuth: []
paths:
  /status:
    get:
      summary: Status
`,
    "text/yaml",
  );

  assert.equal(parsed.detail.specification.status, "PARSED");
  assert.equal(parsed.detail.specification.auth.status, "REQUIRED");
  assert.deepEqual(parsed.detail.specification.auth.schemes, [
    { name: "bearerAuth", type: "http", scheme: "bearer", location: null },
  ]);
  assert.equal(parsed.detail.safeEndpoint, null);
  assert.equal(parsed.candidate, null);
});