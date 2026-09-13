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
          responses: {
            "200": {
              description: "Agent discovery metadata",
              content: { "application/json": { schema: { $ref: "#/components/schemas/PublicDiscovery" } } },
            },
          },
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
            "200": {
              description: "Listed service catalog",
              content: { "application/json": { schema: { $ref: "#/components/schemas/PublicServiceCatalog" } } },
            },
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
            "200": {
              description: "Public trust metadata or an unverified external discovery detail",
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      { $ref: "#/components/schemas/PublicService" },
                      { $ref: "#/components/schemas/PublicExternalDiscoveryDetail" },
                    ],
                  },
                },
              },
            },
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
            "200": {
              description: "ALLOW, CAUTION, or BLOCK based on stored checks",
              content: { "application/json": { schema: { $ref: "#/components/schemas/PublicPreActionCheck" } } },
            },
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
            "200": {
              description: "ALLOW, CAUTION, or BLOCK based on stored checks",
              content: { "application/json": { schema: { $ref: "#/components/schemas/PublicPreActionCheck" } } },
            },
            "400": { description: "Invalid action context" },
            "404": { description: "Service is not listed or does not exist" },
            "429": { description: "Rate limited; inspect Retry-After" },
          },
        },
      },
      "/public/services/{id}/external-check": {
        post: {
          operationId: "postPublicExternalCheck",
          description: "Rate-limited, non-persisted Bond402 check for an exact safe HTTPS GET/HEAD candidate.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PublicExternalCheckBody" },
              },
            },
          },
          responses: {
            "200": {
              description: "Non-persisted Bond402 observation",
              content: { "application/json": { schema: { $ref: "#/components/schemas/PublicExternalCheckResponse" } } },
            },
            "400": { description: "Endpoint is not an approved safe candidate" },
            "404": { description: "External discovery record is unknown" },
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
        PublicExternalCheckBody: {
          type: "object",
          required: ["method", "path", "url"],
          properties: {
            method: { type: "string", enum: ["GET", "HEAD"] },
            path: { type: "string" },
            url: { type: "string", format: "uri" },
          },
        },
        PublicExternalCheckResponse: {
          type: "object",
          required: ["serviceId", "endpoint", "verification", "check", "usage", "safety"],
          properties: {
            serviceId: { type: "string" },
            endpoint: { $ref: "#/components/schemas/PublicExternalCheckBody" },
            verification: {
              type: "object",
              required: ["status", "trustStatus", "checkedAt", "persisted"],
              properties: {
                status: { type: "string", enum: ["CHECKED_EXTERNAL"] },
                trustStatus: { type: "string", enum: ["UNVERIFIED_EXTERNAL"] },
                checkedAt: { type: "string", format: "date-time" },
                persisted: { type: "boolean" },
              },
            },
            check: { type: "object", additionalProperties: true },
            usage: { type: "object", additionalProperties: true },
            safety: { type: "object", additionalProperties: true },
          },
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
        SignalState: {
          type: "string",
          enum: ["CHECKED", "WARNING", "UNAVAILABLE", "NOT_EVALUATED"],
        },
        SecurityHeaders: {
          type: "object",
          required: ["status", "evaluated", "present", "missing"],
          properties: {
            status: { $ref: "#/components/schemas/SignalState" },
            evaluated: { type: "array", items: { type: "string" } },
            present: { type: "array", items: { type: "string" } },
            missing: { type: "array", items: { type: "string" } },
          },
        },
        SecuritySignalStatus: {
          type: "string",
          enum: ["PASS", "WARNING", "FAIL", "UNKNOWN"],
        },
        SecurityStatus: {
          type: "string",
          enum: ["SANDBOX_PENDING", "SANDBOXED_OBSERVED", "VERIFIED_LOW_RISK", "SUSPICIOUS", "FLAGGED"],
        },
        ResponseContentKind: {
          type: "string",
          enum: ["JSON", "TEXT", "HTML", "JAVASCRIPT", "BINARY", "DOWNLOAD", "UNKNOWN"],
        },
        SecurityConfidence: {
          type: "object",
          required: ["status", "score", "summary"],
          properties: {
            status: { $ref: "#/components/schemas/SecuritySignalStatus" },
            score: { type: ["number", "null"] },
            summary: { type: "string" },
          },
        },
        ThreatIndicators: {
          type: "object",
          required: ["status", "severity", "confidence", "indicators", "summary"],
          properties: {
            status: { type: "string", enum: ["NONE_DETECTED", "SUSPICIOUS", "FLAGGED", "UNKNOWN"] },
            severity: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
            confidence: { type: "number" },
            indicators: { type: "array", items: { type: "string" } },
            summary: { type: "string" },
          },
        },
        HistoricalDrift: {
          type: "object",
          required: ["status", "indicators", "summary"],
          properties: {
            status: { type: "string", enum: ["NONE", "CHANGED", "UNKNOWN"] },
            indicators: { type: "array", items: { type: "string" } },
            summary: { type: "string" },
          },
        },
        SecuritySignals: {
          type: "object",
          required: [
            "reachability",
            "transport",
            "network",
            "redirects",
            "responseType",
            "suspiciousPayload",
            "securityHeaders",
            "reputation",
            "rateLimit",
            "authentication",
            "securityConfidence",
            "threatIndicators",
            "historicalDrift",
          ],
          properties: {
            reachability: {
              type: "object",
              required: ["status", "summary"],
              properties: {
                status: { $ref: "#/components/schemas/SecuritySignalStatus" },
                summary: { type: "string" },
              },
            },
            transport: {
              type: "object",
              required: ["status", "summary", "https", "protocol", "certificateValid", "expiresAt", "daysRemaining"],
              properties: {
                status: { $ref: "#/components/schemas/SecuritySignalStatus" },
                summary: { type: "string" },
                https: { type: "boolean" },
                protocol: { type: ["string", "null"] },
                certificateValid: { type: ["boolean", "null"] },
                expiresAt: { type: ["string", "null"] },
                daysRemaining: { type: ["number", "null"] },
              },
            },
            network: {
              type: "object",
              required: ["status", "summary"],
              properties: {
                status: { $ref: "#/components/schemas/SecuritySignalStatus" },
                summary: { type: "string" },
              },
            },
            redirects: {
              type: "object",
              required: ["status", "summary", "count", "crossOrigin", "downgraded"],
              properties: {
                status: { $ref: "#/components/schemas/SecuritySignalStatus" },
                summary: { type: "string" },
                count: { type: "number" },
                crossOrigin: { type: "boolean" },
                downgraded: { type: "boolean" },
              },
            },
            responseType: {
              type: "object",
              required: ["status", "summary", "kind", "contentType"],
              properties: {
                status: { $ref: "#/components/schemas/SecuritySignalStatus" },
                summary: { type: "string" },
                kind: { $ref: "#/components/schemas/ResponseContentKind" },
                contentType: { type: ["string", "null"] },
              },
            },
            suspiciousPayload: {
              type: "object",
              required: ["status", "summary", "indicators"],
              properties: {
                status: { $ref: "#/components/schemas/SecuritySignalStatus" },
                summary: { type: "string" },
                indicators: { type: "array", items: { type: "string" } },
              },
            },
            securityHeaders: {
              type: "object",
              required: ["status", "summary", "evaluated", "present", "missing"],
              properties: {
                status: { $ref: "#/components/schemas/SecuritySignalStatus" },
                summary: { type: "string" },
                evaluated: { type: "array", items: { type: "string" } },
                present: { type: "array", items: { type: "string" } },
                missing: { type: "array", items: { type: "string" } },
              },
            },
            reputation: {
              type: "object",
              required: ["status", "summary"],
              properties: {
                status: { type: "string", enum: ["UNKNOWN"] },
                summary: { type: "string" },
              },
            },
            rateLimit: {
              type: "object",
              required: ["status", "summary", "detected", "retryAfterSeconds"],
              properties: {
                status: { $ref: "#/components/schemas/SecuritySignalStatus" },
                summary: { type: "string" },
                detected: { type: "boolean" },
                retryAfterSeconds: { type: ["number", "null"] },
              },
            },
            authentication: {
              type: "object",
              required: ["status", "summary", "required"],
              properties: {
                status: { $ref: "#/components/schemas/SecuritySignalStatus" },
                summary: { type: "string" },
                required: { type: "boolean" },
              },
            },
            securityConfidence: { $ref: "#/components/schemas/SecurityConfidence" },
            threatIndicators: { $ref: "#/components/schemas/ThreatIndicators" },
            historicalDrift: { $ref: "#/components/schemas/HistoricalDrift" },
          },
        },
        SignalStates: {
          type: "object",
          required: ["https", "tls", "securityHeaders"],
          properties: {
            https: { $ref: "#/components/schemas/SignalState" },
            tls: { $ref: "#/components/schemas/SignalState" },
            securityHeaders: { $ref: "#/components/schemas/SignalState" },
          },
        },
        DomainSignalState: {
          type: "string",
          enum: ["CHECKED", "WARNING", "UNAVAILABLE", "NOT_EVALUATED", "NOT_APPLICABLE"],
        },
        RegionalAggregation: {
          type: "object",
          required: [
            "state",
            "regionCount",
            "regions",
            "liveCheckCount",
            "evaluatedCheckCount",
            "unassignedLiveCheckCount",
            "regionalResults",
            "contradictorySignals",
            "observationBasis",
            "continuousMonitoring",
            "description",
          ],
          properties: {
            state: {
              type: "string",
              enum: [
                "SINGLE_REGION",
                "MULTIPLE_REGIONS",
                "CONTRADICTORY_REGIONAL_RESULTS",
                "INSUFFICIENT_REGIONAL_DATA",
              ],
            },
            regionCount: { type: "number" },
            regions: { type: "array", items: { type: "string" } },
            liveCheckCount: { type: "number" },
            evaluatedCheckCount: { type: "number" },
            unassignedLiveCheckCount: { type: "number" },
            regionalResults: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "region",
                  "sampleCount",
                  "latestCheckAt",
                  "latestStatus",
                  "latestReachable",
                ],
                properties: {
                  region: { type: "string" },
                  sampleCount: { type: "number" },
                  latestCheckAt: { type: "string", format: "date-time" },
                  latestStatus: { type: "string", enum: ["PASS", "FAIL", "REVIEW"] },
                  latestReachable: { type: "boolean" },
                },
              },
            },
            contradictorySignals: {
              type: "array",
              items: {
                type: "string",
                enum: ["status", "reachability", "https", "tls", "securityHeaders"],
              },
            },
            observationBasis: { type: "string", enum: ["STORED_LIVE_CHECKS"] },
            continuousMonitoring: { type: "boolean", enum: [false] },
            description: { type: "string" },
          },
        },
        TrustMetrics: {
          type: "object",
          required: ["sampleCount", "timedSampleCount", "uptimePercent", "averageResponseTimeMs", "p95ResponseTimeMs", "p99ResponseTimeMs", "withinTargetPercent", "windowStartAt", "latestCheckAt", "weighting", "regionalAggregation"],
          properties: {
            sampleCount: { type: "number" },
            timedSampleCount: { type: "number" },
            uptimePercent: { type: ["number", "null"] },
            averageResponseTimeMs: { type: ["number", "null"] },
            p95ResponseTimeMs: { type: ["number", "null"] },
            p99ResponseTimeMs: { type: ["number", "null"] },
            withinTargetPercent: { type: ["number", "null"] },
            windowStartAt: { type: ["string", "null"], format: "date-time" },
            latestCheckAt: { type: ["string", "null"], format: "date-time" },
            weighting: { type: "object" },
            regionalAggregation: { $ref: "#/components/schemas/RegionalAggregation" },
          },
        },
        DomainVerification: {
          type: "object",
          required: ["status", "verifiedAt"],
          properties: {
            status: {
              type: "string",
              enum: ["VERIFIED", "PENDING", "NOT_STARTED", "NOT_APPLICABLE", "NOT_EVALUATED"],
            },
            verifiedAt: { type: ["string", "null"], format: "date-time" },
          },
        },
        DomainRelationship: {
          type: "string",
          enum: ["OWNED", "THIRD_PARTY"],
        },
        PublicDiscoverySource: {
          type: "object",
          required: ["source", "sourceLabel", "scope", "externalSources", "mode", "fallback"],
          properties: {
            source: {
              type: "string",
              enum: ["BOND402_INTERNAL_CATALOG", "APIS_GURU_OPENAPI_DIRECTORY"],
            },
            sourceLabel: { type: "string" },
            scope: {
              type: "string",
              enum: ["LISTED_SERVICES_ONLY", "PUBLIC_UNVERIFIED_OPENAPI"],
            },
            externalSources: { type: "boolean" },
            mode: { type: "string", enum: ["INTERNAL_PRIMARY", "EXTERNAL_FALLBACK"] },
            fallback: { type: "string", enum: ["NOT_USED", "USED", "UNAVAILABLE"] },
            sourceUrl: { type: "string" },
          },
        },
        PublicServiceDiscovery: {
          type: "object",
          required: ["source", "sourceLabel", "scope", "matchScore", "rankingFactors", "evidence"],
          properties: {
            source: { type: "string", enum: ["BOND402_INTERNAL_CATALOG"] },
            sourceLabel: { type: "string" },
            scope: { type: "string", enum: ["LISTED_SERVICES_ONLY"] },
            matchScore: { type: "number", minimum: 0, maximum: 100 },
            rankingFactors: {
              type: "object",
              required: ["textRelevance", "observationCoverage", "observationFreshness", "publicSource"],
              properties: {
                textRelevance: { type: "number", minimum: 0, maximum: 1 },
                observationCoverage: { type: "number", minimum: 0, maximum: 1 },
                observationFreshness: { type: "number", minimum: 0, maximum: 1 },
                publicSource: { type: "number", minimum: 0, maximum: 1 },
              },
            },
            evidence: {
              type: "object",
              required: ["liveObservationCount", "latestObservationAt", "publicSourceUrl"],
              properties: {
                liveObservationCount: { type: "number", minimum: 0 },
                latestObservationAt: { type: ["string", "null"], format: "date-time" },
                publicSourceUrl: { type: "string" },
              },
            },
          },
        },
        PublicService: {
          type: "object",
          required: ["id", "name", "url", "trustScore", "trustExplanation", "availabilityScore", "securityConfidence", "securityStatus", "firstSeenAt", "sandboxObservedAt", "trustMetrics", "signals", "domainVerification", "domainRelationship", "latestStatus", "latestCheckAt", "latestCheck", "access", "links"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            url: { type: "string" },
            trustScore: { type: ["number", "null"] },
            trustExplanation: { type: "string" },
            availabilityScore: { type: ["number", "null"] },
            securityConfidence: { $ref: "#/components/schemas/SecurityConfidence" },
            securityStatus: { $ref: "#/components/schemas/SecurityStatus" },
            firstSeenAt: { type: "string", format: "date-time" },
            sandboxObservedAt: { type: ["string", "null"], format: "date-time" },
            trustMetrics: { $ref: "#/components/schemas/TrustMetrics" },
            signals: { $ref: "#/components/schemas/SignalStates" },
            domainVerification: { $ref: "#/components/schemas/DomainVerification" },
            domainRelationship: { $ref: "#/components/schemas/DomainRelationship" },
            latestStatus: { type: ["string", "null"], enum: ["PASS", "FAIL", "REVIEW", null] },
            latestCheckAt: { type: ["string", "null"], format: "date-time" },
            latestCheck: { type: ["object", "null"] },
            access: { type: "object" },
            links: { type: "object" },
            discovery: { $ref: "#/components/schemas/PublicServiceDiscovery" },
          },
        },
        PublicExternalDiscovery: {
          type: "object",
          required: ["source", "sourceLabel", "scope", "verification", "matchScore", "rankingFactors", "evidence"],
          properties: {
            source: { type: "string", enum: ["APIS_GURU_OPENAPI_DIRECTORY"] },
            sourceLabel: { type: "string" },
            scope: { type: "string", enum: ["PUBLIC_UNVERIFIED_OPENAPI"] },
            verification: { type: "string", enum: ["UNVERIFIED_EXTERNAL"] },
            matchScore: { type: "number", minimum: 0, maximum: 100 },
            rankingFactors: {
              type: "object",
              required: ["textRelevance", "sourceFreshness", "openApiMetadata"],
              properties: {
                textRelevance: { type: "number", minimum: 0, maximum: 1 },
                sourceFreshness: { type: "number", minimum: 0, maximum: 1 },
                openApiMetadata: { type: "number", minimum: 0, maximum: 1 },
              },
            },
            evidence: {
              type: "object",
              required: ["provider", "sourceRecordUrl", "specificationUrl", "openapiVersion", "updatedAt"],
              properties: {
                provider: { type: "string" },
                sourceRecordUrl: { type: "string" },
                specificationUrl: { type: "string" },
                openapiVersion: { type: ["string", "null"] },
                updatedAt: { type: ["string", "null"], format: "date-time" },
              },
            },
          },
        },
        PublicExternalService: {
          type: "object",
          required: ["id", "kind", "name", "description", "url", "verification", "discovery", "links"],
          properties: {
            id: { type: "string" },
            kind: { type: "string", enum: ["EXTERNAL_DISCOVERY"] },
            name: { type: "string" },
            description: { type: ["string", "null"] },
            url: { type: "string" },
            verification: {
              type: "object",
              required: ["status", "reason"],
              properties: {
                status: { type: "string", enum: ["UNVERIFIED_EXTERNAL"] },
                reason: { type: "string", enum: ["SOURCE_METADATA_ONLY_NO_BOND402_CHECK"] },
              },
            },
            discovery: { $ref: "#/components/schemas/PublicExternalDiscovery" },
            links: {
              type: "object",
              required: ["sourceRecord", "specification"],
              properties: {
                sourceRecord: { type: "string" },
                specification: { type: "string" },
              },
            },
          },
        },
        PublicExternalDiscoveryDetail: {
          type: "object",
          required: ["id", "kind", "name", "provider", "version", "description", "source", "verification", "specification", "safeEndpoint", "safeEndpoints", "safeEndpointNote"],
          properties: {
            id: { type: "string" },
            kind: { type: "string", enum: ["EXTERNAL_DISCOVERY_DETAIL"] },
            name: { type: "string" },
            provider: { type: "string" },
            version: { type: "string" },
            description: { type: ["string", "null"] },
            source: {
              type: "object",
              required: ["id", "label", "catalogUrl", "recordUrl", "specificationUrl"],
              properties: {
                id: { type: "string", enum: ["APIS_GURU_OPENAPI_DIRECTORY"] },
                label: { type: "string" },
                catalogUrl: { type: "string", format: "uri" },
                recordUrl: { type: "string", format: "uri" },
                specificationUrl: { type: "string", format: "uri" },
              },
            },
            verification: {
              type: "object",
              required: ["status", "reason"],
              properties: {
                status: { type: "string", enum: ["UNVERIFIED_EXTERNAL"] },
                reason: { type: "string", enum: ["SPECIFICATION_METADATA_ONLY_NO_BOND402_CHECK"] },
              },
            },
            specification: {
              type: "object",
              required: ["status", "openapiVersion", "title", "description", "servers", "auth", "endpoints"],
              properties: {
                status: { type: "string", enum: ["PARSED", "UNAVAILABLE", "UNSUPPORTED"] },
                openapiVersion: { type: ["string", "null"] },
                title: { type: ["string", "null"] },
                description: { type: ["string", "null"] },
                servers: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["url", "description", "templated"],
                    properties: {
                      url: { type: "string", format: "uri" },
                      description: { type: ["string", "null"] },
                      templated: { type: "boolean" },
                    },
                  },
                },
                auth: {
                  type: "object",
                  required: ["status", "schemes"],
                  properties: {
                    status: { type: "string", enum: ["REQUIRED", "NOT_REQUIRED", "NOT_DECLARED", "UNKNOWN"] },
                    schemes: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["name", "type", "scheme", "location"],
                        properties: {
                          name: { type: "string" },
                          type: { type: "string" },
                          scheme: { type: ["string", "null"] },
                          location: { type: ["string", "null"] },
                        },
                      },
                    },
                  },
                },
                endpoints: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["method", "path", "summary", "operationId", "auth", "safeToProbe", "reason"],
                    properties: {
                      method: { type: "string" },
                      path: { type: "string" },
                      summary: { type: ["string", "null"] },
                      operationId: { type: ["string", "null"] },
                      auth: { type: "string", enum: ["REQUIRED", "NOT_REQUIRED", "NOT_DECLARED", "UNKNOWN"] },
                      safeToProbe: { type: "boolean" },
                      reason: { type: "string" },
                    },
                  },
                },
              },
            },
            safeEndpoint: {
              oneOf: [
                { type: "null" },
                {
                  type: "object",
                  required: ["method", "path", "url", "reason"],
                  properties: {
                    method: { type: "string", enum: ["GET", "HEAD"] },
                    path: { type: "string" },
                    url: { type: "string", format: "uri" },
                    reason: { type: "string", enum: ["EXPLICITLY_PUBLIC_PARAMETER_FREE_READ"] },
                  },
                },
              ],
            },
            safeEndpoints: {
              type: "array",
              items: {
                type: "object",
                required: ["method", "path", "url", "reason"],
                properties: {
                  method: { type: "string", enum: ["GET", "HEAD"] },
                  path: { type: "string" },
                  url: { type: "string", format: "uri" },
                  reason: { type: "string", enum: ["EXPLICITLY_PUBLIC_PARAMETER_FREE_READ"] },
                },
              },
            },
            safeEndpointNote: { type: "string" },
          },
        },
        PublicServiceCatalog: {
          type: "object",
          required: ["items", "query", "page", "pageSize", "total", "hasNextPage", "sort", "source"],
          properties: {
            items: {
              type: "array",
              items: {
                oneOf: [
                  { $ref: "#/components/schemas/PublicService" },
                  { $ref: "#/components/schemas/PublicExternalService" },
                ],
              },
            },
            query: { type: "string" },
            page: { type: "number" },
            pageSize: { type: "number" },
            total: { type: "number" },
            hasNextPage: { type: "boolean" },
            sort: { type: "string" },
            source: { $ref: "#/components/schemas/PublicDiscoverySource" },
          },
        },
        PublicDiscovery: {
          type: "object",
          required: ["version", "dataSource"],
          properties: {
            version: { type: "string" },
            dataSource: {
              type: "object",
              required: ["source", "sourceLabel", "scope", "externalSources", "fallbackPolicy", "fallbacks", "ranking"],
              properties: {
                source: { type: "string", enum: ["BOND402_INTERNAL_CATALOG"] },
                sourceLabel: { type: "string" },
                scope: { type: "string", enum: ["LISTED_SERVICES_ONLY"] },
                externalSources: { type: "boolean", enum: [false] },
                fallbackPolicy: { type: "string" },
                fallbacks: {
                  type: "array",
                  items: { $ref: "#/components/schemas/PublicDiscoverySource" },
                },
                ranking: { type: "array", items: { type: "string" } },
              },
            },
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
            factors: {
              type: "object",
              properties: {
                signals: {
                  type: "object",
                  properties: {
                    https: { $ref: "#/components/schemas/SignalState" },
                    tls: { $ref: "#/components/schemas/SignalState" },
                    securityHeaders: { $ref: "#/components/schemas/SignalState" },
                    domain: { $ref: "#/components/schemas/DomainSignalState" },
                  },
                },
                trustMetrics: { $ref: "#/components/schemas/TrustMetrics" },
              },
            },
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