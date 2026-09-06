export function getPublicOpenApiDocument(baseUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Bond402 Public Agent API",
      version: "0.3.0-public-beta",
      description:
        "Öffentliche, nur lesende Discovery- und Trust-Metadaten für gelistete API-Dienste. Bond402 ist kein universelles Verzeichnis und ALLOW ist keine Sicherheitsgarantie.",
    },
    servers: [{ url: `${baseUrl}/api`, description: "Bond402 production API" }],
    paths: {
      "/public/discovery": {
        get: {
          operationId: "getPublicDiscovery",
          responses: { "200": { description: "Agent discovery metadata" } },
        },
      },
      "/public/services": {
        get: {
          operationId: "searchPublicServices",
          parameters: [
            { name: "q", in: "query", schema: { type: "string", maxLength: 120 } },
            { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
            { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
          ],
          responses: {
            "200": { description: "Listed service catalog" },
            "400": { description: "Invalid query" },
            "429": { description: "Rate limited; inspect Retry-After" },
          },
        },
      },
      "/public/services/{id}": {
        get: {
          operationId: "getPublicService",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Public trust metadata" },
            "404": { description: "Service is not listed or does not exist" },
            "429": { description: "Rate limited; inspect Retry-After" },
          },
        },
      },
      "/public/services/{id}/pre-action-check": {
        get: {
          operationId: "getPublicPreActionCheck",
          description: "Read-only decision from stored checks. No live check is triggered.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "ALLOW, CAUTION, or BLOCK based on stored checks" },
            "404": { description: "Service is not listed or does not exist" },
            "429": { description: "Rate limited; inspect Retry-After" },
          },
        },
        post: {
          operationId: "postPublicPreActionCheck",
          description: "Read-only decision with explicit action context. No live check is triggered.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    actionContext: { $ref: "#/components/schemas/ActionContext" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "ALLOW, CAUTION, or BLOCK based on stored checks" },
            "400": { description: "Invalid action context" },
            "404": { description: "Service is not listed or does not exist" },
            "429": { description: "Rate limited; inspect Retry-After" },
          },
        },
      },
      "/developer/services/{id}/pre-action-check": {
        post: {
          operationId: "developerPreActionCheck",
          security: [{ Bond402ApiKey: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Owner-only quota-counted pre-action decision" },
            "401": { description: "Developer key required" },
            "404": { description: "Owned service not found" },
            "429": { description: "Key, owner, or monthly quota limit" },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        Bond402ApiKey: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "Bond402 API key",
        },
      },
      schemas: {
        Decision: { type: "string", enum: ["ALLOW", "CAUTION", "BLOCK"] },
        ActionContext: {
          type: "string",
          enum: ["GENERAL", "READ", "WRITE", "PAYMENT", "CREDENTIAL_USE"],
        },
        Freshness: {
          type: "object",
          required: ["state", "ageSeconds", "maxAgeSeconds"],
          properties: {
            state: { type: "string", enum: ["FRESH", "STALE", "UNKNOWN"] },
            ageSeconds: { type: ["number", "null"] },
            maxAgeSeconds: { type: "number" },
          },
        },
        PreActionPolicy: {
          type: "object",
          required: ["id", "version", "maxFreshnessSeconds"],
          properties: {
            id: { type: "string" },
            version: { type: "string" },
            maxFreshnessSeconds: { type: "number" },
          },
        },
        PublicPreActionCheck: {
          type: "object",
          required: ["serviceId", "serviceName", "decision", "reasons", "actionContext", "freshness", "policy", "access", "usage"],
          properties: {
            serviceId: { type: "string" },
            serviceName: { type: "string" },
            decision: { $ref: "#/components/schemas/Decision" },
            reasons: { type: "array", items: { type: "string" } },
            actionContext: { $ref: "#/components/schemas/ActionContext" },
            freshness: { $ref: "#/components/schemas/Freshness" },
            policy: { $ref: "#/components/schemas/PreActionPolicy" },
            access: {
              type: "object",
              properties: {
                requiresDeveloperKey: { type: "boolean" },
                liveCheckRequiresDeveloperKey: { type: "boolean" },
              },
            },
            usage: {
              type: "object",
              properties: {
                countsAgainstMonthlyPlan: { type: "boolean" },
                rateLimit: { type: "string" },
              },
            },
          },
        },
      },
    },
  };
}