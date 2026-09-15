import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, ilike, or } from "drizzle-orm";
import { apiServicesTable, db } from "@workspace/db";
import { consumePublicRateLimit } from "../lib/api-key-auth";
import {
  PUBLIC_DISCOVERY_SOURCE,
  PUBLIC_DISCOVERY_SOURCE_LABEL,
  shouldUseExternalDiscoveryFallback,
  rankPublicServiceResults,
  rankPublicDiscoveryResults,
} from "../lib/public-service-search";
import {
  loadPublicDiscoveryRecord,
  loadPublicDiscoveryRecords,
  publicDiscoveryCandidateFromExternalRecord,
  PUBLIC_DISCOVERY_RECORD_MAX_AGE_MS,
  refreshPublicDiscoveryRecords,
} from "../lib/public-internal-discovery";
import {
  PUBLIC_EXTERNAL_DISCOVERY_SCOPE,
  PUBLIC_EXTERNAL_DISCOVERY_SOURCE,
  PUBLIC_EXTERNAL_DISCOVERY_SOURCE_LABEL,
  PUBLIC_EXTERNAL_DISCOVERY_SOURCE_URL,
  PUBLIC_EXTERNAL_CATALOG_SOURCE,
  PUBLIC_EXTERNAL_CATALOG_SOURCE_LABEL,
  PUBLIC_API_DIRECTORY_SOURCE,
  PUBLIC_API_DIRECTORY_SOURCE_LABEL,
  PUBLIC_API_DIRECTORY_SOURCE_URL,
  PUBLIC_API_DIRECTORY_SCOPE,
  dedupeExternalDiscoveryRecords,
  getCachedPublicApisCatalog,
  getCachedApisGuruCatalog,
  loadPublicApisCatalog,
  loadApisGuruCatalog,
  rankExternalDiscoveryResults,
} from "../lib/public-external-discovery";
import { getExternalApiDetail } from "../lib/public-external-detail";
import { runLiveVerification } from "../lib/api-verifier";
import { loadChecks, toPublicServiceResponse } from "../lib/service-data";
import {
  evaluatePreAction,
  PRE_ACTION_POLICY,
  type ActionContext,
} from "../lib/pre-action";
import { getPublicOpenApiDocument } from "../lib/public-openapi";
import { publicBaseUrl } from "../lib/public-sitemap";
import {
  AGENT_FEEDBACK_CONTRACT_VERSION,
  AGENT_FEEDBACK_STATUSES,
  createAgentFeedback,
  feedbackForDecision,
  feedbackForHttpError,
} from "../lib/agent-feedback";
import { discoverDirectOpenApi, rememberExternalApiDetail } from "../lib/public-external-detail";
import {
  buildPublicAgentDecision,
  buildPublicAgentFeedback,
} from "../lib/agent-decision-public";

const router: IRouter = Router();
const PUBLIC_RATE_LIMIT = 60;
const PUBLIC_EXTERNAL_CHECK_RATE_LIMIT = 12;
const validActionContexts = ["GENERAL", "READ", "WRITE", "PAYMENT", "CREDENTIAL_USE"] as const;

function parseCatalogQuery(query: Request["query"]) {
  const qValue = query.q;
  const pageValue = query.page;
  const pageSizeValue = query.pageSize;
  const q = typeof qValue === "string" ? qValue.trim() : qValue === undefined ? "" : null;
  const page = pageValue === undefined ? 1 : Number(pageValue);
  const pageSize = pageSizeValue === undefined ? 20 : Number(pageSizeValue);
  if (
    q === null ||
    q.length > 120 ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10_000 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 50
  ) {
    return null;
  }
  return { q, page, pageSize };
}

function sendPublicError(
  res: Response,
  status: number,
  error: string,
  code: string,
  context: Parameters<typeof feedbackForHttpError>[3] = {},
) {
  res.status(status).json({
    error,
    code,
    feedback: feedbackForHttpError(status, code, error, context),
  });
}

async function requirePublicRateLimit(req: Request, res: Response) {
  const rate = await consumePublicRateLimit(req.ip || "unknown", "catalog", PUBLIC_RATE_LIMIT);
  if (rate.allowed) return true;
  res.set("Retry-After", String(rate.retryAfter));
  res.status(429).json({
    error: "Zu viele öffentliche Kataloganfragen. Bitte warten Sie kurz.",
    code: "RATE_LIMITED",
    retryAfterSeconds: rate.retryAfter,
    feedback: createAgentFeedback({
      status: "RATE_LIMITED",
      code: "RATE_LIMITED",
      summary: "Das öffentliche Bond402-Limit wurde erreicht.",
      nextAction: "Retry-After beachten und später erneut versuchen.",
      httpStatus: 429,
      retryAfterSeconds: rate.retryAfter,
    }),
  });
  return false;
}

async function requireExternalCheckRateLimit(req: Request, res: Response) {
  const rate = await consumePublicRateLimit(req.ip || "unknown", "external-check", PUBLIC_EXTERNAL_CHECK_RATE_LIMIT);
  if (rate.allowed) return true;
  res.set("Retry-After", String(rate.retryAfter));
  res.status(429).json({
    error: "Zu viele externe Prüfungen. Bitte warten Sie kurz.",
    code: "RATE_LIMITED",
    retryAfterSeconds: rate.retryAfter,
    feedback: createAgentFeedback({
      status: "RATE_LIMITED",
      code: "RATE_LIMITED",
      summary: "Das öffentliche Limit für externe Prüfungen wurde erreicht.",
      nextAction: "Retry-After beachten und später erneut versuchen.",
      httpStatus: 429,
      retryAfterSeconds: rate.retryAfter,
    }),
  });
  return false;
}

const PUBLIC_SERVICE_SECURITY_STATUS = "VERIFIED_LOW_RISK";

async function loadPublicService(id: string) {
  const [service] = await db
    .select()
    .from(apiServicesTable)
    .where(
      and(
        eq(apiServicesTable.id, id),
        eq(apiServicesTable.visibility, "LISTED"),
        eq(apiServicesTable.securityStatus, PUBLIC_SERVICE_SECURITY_STATUS),
      ),
    );
  return service;
}

function internalCatalogSource(
  fallback: "NOT_USED" | "UNAVAILABLE" = "NOT_USED",
  status: "AVAILABLE" | "STALE_RECORDS_HIDDEN" | "UNAVAILABLE" = fallback === "UNAVAILABLE"
    ? "UNAVAILABLE"
    : "AVAILABLE",
) {
  return {
    source: PUBLIC_DISCOVERY_SOURCE,
    sourceLabel: PUBLIC_DISCOVERY_SOURCE_LABEL,
    scope: "LISTED_SERVICES_AND_PUBLIC_DISCOVERY" as const,
    externalSources: false as const,
    mode: "INTERNAL_PRIMARY" as const,
    fallback,
    refresh: {
      policy: "ON_CATALOG_READ_IF_STALE",
      maxAgeSeconds: Math.floor(PUBLIC_DISCOVERY_RECORD_MAX_AGE_MS / 1000),
      staleRecordsExcluded: true,
      lastAttemptAt: new Date().toISOString(),
      status,
    },
  };
}

function externalCatalogSource(
  apisGuruStatus: "AVAILABLE" | "UNAVAILABLE",
  publicApisStatus: "AVAILABLE" | "UNAVAILABLE",
) {
  return {
    source: PUBLIC_EXTERNAL_CATALOG_SOURCE,
    sourceLabel: PUBLIC_EXTERNAL_CATALOG_SOURCE_LABEL,
    scope: "PUBLIC_UNVERIFIED_EXTERNAL_CATALOG" as const,
    externalSources: true as const,
    mode: "EXTERNAL_FALLBACK" as const,
    fallback: "USED" as const,
    sourceUrl: `${PUBLIC_EXTERNAL_DISCOVERY_SOURCE_URL},${PUBLIC_API_DIRECTORY_SOURCE_URL}`,
    refresh: {
      policy: "ON_CATALOG_READ_IF_STALE",
      maxAgeSeconds: Math.floor(PUBLIC_DISCOVERY_RECORD_MAX_AGE_MS / 1000),
      staleRecordsExcluded: true,
      lastAttemptAt: new Date().toISOString(),
      status: apisGuruStatus === "AVAILABLE" || publicApisStatus === "AVAILABLE"
        ? "AVAILABLE"
        : "UNAVAILABLE",
      sources: [
        { source: PUBLIC_EXTERNAL_DISCOVERY_SOURCE, status: apisGuruStatus },
        { source: PUBLIC_API_DIRECTORY_SOURCE, status: publicApisStatus },
      ],
    },
  };
}

router.get("/openapi.json", async (req, res): Promise<void> => {
  if (!(await requirePublicRateLimit(req, res))) return;
  res.type("application/json").json(getPublicOpenApiDocument(publicBaseUrl(req)));
});

router.get("/public/agent-onboarding", async (req, res): Promise<void> => {
  if (!(await requirePublicRateLimit(req, res))) return;
  res.json({
    version: "headless-agent-onboarding-v1",
    purpose:
      "Maschinenlesbarer Ablauf von öffentlicher Discovery bis zum owner-gebundenen Developer-Live-Check.",
    feedback: {
      contractVersion: AGENT_FEEDBACK_CONTRACT_VERSION,
      statuses: AGENT_FEEDBACK_STATUSES,
      secretPolicy: "Secrets erscheinen nur unmittelbar bei der Erstellung und niemals in Logs oder Fehlermeldungen.",
    },
    steps: [
      {
        id: "public-discovery",
        visibility: "PUBLIC",
        method: "GET",
        path: "/api/public/services?q={query}",
        authentication: "NONE",
        next: "agent-decision-or-direct-openapi-discovery-or-public-detail",
      },
      {
        id: "agent-decision",
        visibility: "PUBLIC",
        method: "POST",
        path: "/api/public/agent/decision",
        authentication: "NONE",
        policy: "DETERMINISTIC_READ_ONLY_DECISION_NO_EXECUTION",
        body: { task: "<natural-language-agent-task>" },
        next: "public-detail-or-safe-external-preflight",
      },
      {
        id: "direct-openapi-discovery",
        visibility: "PUBLIC",
        method: "POST",
        path: "/api/public/discovery/openapi",
        authentication: "NONE",
        body: { url: "https://api.example.com" },
        next: "public-detail-and-safe-external-preflight",
      },
      {
        id: "public-detail",
        visibility: "PUBLIC",
        method: "GET",
        path: "/api/public/services/{id}",
        authentication: "NONE",
        next: "public-pre-action-or-owner-bootstrap",
      },
      {
        id: "public-pre-action",
        visibility: "PUBLIC",
        method: "GET",
        path: "/api/public/services/{id}/pre-action-check",
        authentication: "NONE",
        policy: "READ_ONLY_STORED_SIGNALS",
        next: "owner-bootstrap-for-private-or-live-actions",
      },
      {
        id: "safe-external-check",
        visibility: "PUBLIC",
        method: "POST",
        path: "/api/public/services/{id}/external-check",
        authentication: "NONE",
        policy: "EXACT_BOUNDED_UNAUTHENTICATED_GET_OR_HEAD_ONLY",
        next: "owner-bootstrap-for-persistent-live-checks",
      },
      {
        id: "owner-registration",
        visibility: "OWNER_BOOTSTRAP",
        method: "POST",
        path: "/api/auth/register",
        authentication: "NONE",
        requirement: "EMAIL_VERIFICATION_REQUIRED",
        next: "verify-email",
      },
      {
        id: "verify-email",
        visibility: "OWNER_BOOTSTRAP",
        method: "POST",
        path: "/api/auth/verify-email",
        authentication: "ONE_TIME_EMAIL_TOKEN",
        policy: "TOKEN_MUST_NOT_BE_LOGGED_OR_RETURNED_BY_BOND402",
        next: "owner-session-login",
      },
      {
        id: "owner-session-login",
        visibility: "OWNER_BOOTSTRAP",
        method: "POST",
        path: "/api/auth/login",
        authentication: "NONE",
        result: "HTTP_ONLY_BOND402_SESSION_COOKIE",
        next: "owner-service-registration-and-key-creation",
      },
      {
        id: "owner-service-registration",
        visibility: "OWNER_BOUND",
        method: "POST",
        path: "/api/services",
        authentication: "BOND402_SESSION_COOKIE",
        ownerBinding: "The session owner becomes apiServices.ownerId.",
        next: "developer-key-creation",
      },
      {
        id: "developer-key-creation",
        visibility: "OWNER_BOUND",
        method: "POST",
        path: "/api/api-keys",
        authentication: "BOND402_SESSION_COOKIE",
        result: "SECRET_RETURNED_ONCE",
        policy: "STORE_SECURELY_AND_SEND_ONLY_AS_AUTHORIZATION_BEARER",
        next: "developer-live-check",
      },
      {
        id: "developer-live-check",
        visibility: "OWNER_BOUND",
        method: "POST",
        path: "/api/developer/services/{id}/checks",
        authentication: "BOND402_API_KEY",
        quota: "MONTHLY_PRODUCT_CHECK_QUOTA_AND_DEVELOPER_RATE_LIMIT",
        next: "developer-result-or-feedback-status",
      },
      {
        id: "quota-and-feedback",
        visibility: "OWNER_BOUND",
        method: "POST",
        path: "/api/developer/services/{id}/pre-action-check",
        authentication: "BOND402_API_KEY",
        quota: "PAYMENT_REQUIRED_WHEN_MONTHLY_PRODUCT_QUOTA_IS_EXHAUSTED",
        next: "execute-agent-action-only-after-evaluating-decision-and-feedback",
      },
      {
        id: "execution-plan",
        visibility: "OWNER_BOUND",
        method: "POST",
        path: "/api/developer/execution/plan",
        authentication: "BOND402_API_KEY",
        policy: "PLAN_ONLY_NO_PROVIDER_REQUEST;_OWNER_SERVICE_AND_REGISTERED_OPERATION_ONLY",
        body: {
          task: "<natural-language-agent-task>",
          serviceId: "<optional-owned-service-id>",
          operation: { method: "GET", path: "<registered-service-path>" },
          parameters: { "<declared-query-parameter>": "<typed-value>" },
        },
        next: "execution-execute-only-when-feedback-status-is-READY",
      },
      {
        id: "execution-execute",
        visibility: "OWNER_BOUND",
        method: "POST",
        path: "/api/developer/execution/execute",
        authentication: "BOND402_API_KEY",
        policy: "EXECUTE_ONLY_PREVIOUS_READY_PLAN;GET_HEAD_ONLY;NO_AGENT_CONTROLLED_URL",
        body: { planId: "<plan-id>", parameters: "<exact-parameters-from-plan>" },
        quota: "MONTHLY_PRODUCT_CHECK_QUOTA_AND_DEVELOPER_RATE_LIMIT",
        next: "stable-execution-feedback-status-and-safe-provider-data",
      },
    ],
    securityBoundaries: [
      "Anonymous public steps never create owner services, never issue Developer API keys, and never run persistent owner live checks.",
      "Owner service registration and API-key creation require a verified local account session.",
      "The Developer API key is owner-bound, rate-limited, revocable, and never returned again after creation.",
      "ALLOW and READY describe stored observations or workflow readiness, not a security guarantee.",
      "Execution is owner-bound, consumes quota at EXECUTE time, and never exposes provider credentials.",
      "Only registered HTTPS GET/HEAD operations are executable; mutating methods remain blocked.",
    ],
  });
});

router.post("/public/agent/decision", async (req, res): Promise<void> => {
  if (!(await requirePublicRateLimit(req, res))) return;
  const body = req.body && typeof req.body === "object"
    ? req.body as Record<string, unknown>
    : {};
  const task = body.task;
  if (typeof task !== "string" || task.trim().length === 0 || task.length > 500) {
    sendPublicError(
      res,
      400,
      "Bitte geben Sie genau eine natürliche Agent-Aufgabe mit höchstens 500 Zeichen an.",
      "INVALID_AGENT_TASK",
    );
    return;
  }

  try {
    const decision = await buildPublicAgentDecision(task);
    res.json({
      ...decision,
      feedback: buildPublicAgentFeedback(decision),
    });
  } catch {
    sendPublicError(
      res,
      503,
      "Die öffentlichen Decision-Quellen sind derzeit nicht verfügbar.",
      "DECISION_SOURCES_UNAVAILABLE",
      { source: "BOND402_PUBLIC_AGENT_DECISION" },
    );
  }
});

router.get("/public/discovery", async (req, res): Promise<void> => {
  if (!(await requirePublicRateLimit(req, res))) return;
  const base = publicBaseUrl(req);
  res.json({
    name: "Bond402",
    description:
      "Öffentliche Trust- und Risiko-Metadaten für registrierte, vom Betreiber gelistete API-Dienste.",
    version: "public-beta",
    disclaimer:
      "Bond402 ist kein universelles Verzeichnis aller Internetdienste und ALLOW ist keine Sicherheitsgarantie.",
    authentication: {
      publicCatalog: "none",
      publicPreActionCheck: "none",
      developerApi: "Authorization: Bearer b402_…",
      privilegedActions: "Developer API key and owner authorization required",
      pilotKeyModel:
        "Owner-bound keys; no cross-account delegation, scope selection, or expiry in public beta. Rotate by creating a new key and revoking the old key.",
    },
    endpoints: {
      catalog: `${base}/api/public/services`,
      agentDecision: `${base}/api/public/agent/decision`,
      serviceDetail: `${base}/api/public/services/{id}`,
      publicPreActionCheck: `${base}/api/public/services/{id}/pre-action-check`,
      directOpenApiDiscovery: `${base}/api/public/discovery/openapi`,
      openapi: `${base}/api/openapi.json`,
      humanDocs: `${base}/api-docs`,
      wellKnown: `${base}/.well-known/bond402-agent.json`,
      llms: `${base}/llms.txt`,
    },
    dataSource: {
      source: PUBLIC_DISCOVERY_SOURCE,
      sourceLabel: PUBLIC_DISCOVERY_SOURCE_LABEL,
       scope: "LISTED_SERVICES_AND_PUBLIC_DISCOVERY",
      externalSources: false,
      refresh: {
        policy: "ON_CATALOG_READ_IF_STALE",
        maxAgeSeconds: Math.floor(PUBLIC_DISCOVERY_RECORD_MAX_AGE_MS / 1000),
        staleRecordsExcluded: true,
        lastAttemptAt: new Date().toISOString(),
        status: "AVAILABLE",
      },
      fallbackPolicy:
        "Interne gelistete und persistierte öffentliche Discovery-Treffer zuerst; öffentliche API-/OpenAPI-Quellen nur bei fehlender ausreichender interner Relevanz.",
      fallbacks: [
        {
          source: PUBLIC_EXTERNAL_DISCOVERY_SOURCE,
          sourceLabel: PUBLIC_EXTERNAL_DISCOVERY_SOURCE_LABEL,
          scope: PUBLIC_EXTERNAL_DISCOVERY_SCOPE,
          externalSources: true,
          mode: "EXTERNAL_FALLBACK",
          fallback: "NOT_USED",
          access: "PUBLIC_NO_API_KEY",
          verification: "UNVERIFIED_EXTERNAL",
          sourceUrl: PUBLIC_EXTERNAL_DISCOVERY_SOURCE_URL,
          refresh: {
            policy: "ON_CATALOG_READ_IF_STALE",
            maxAgeSeconds: Math.floor(PUBLIC_DISCOVERY_RECORD_MAX_AGE_MS / 1000),
            staleRecordsExcluded: true,
            lastAttemptAt: new Date().toISOString(),
            status: "NOT_ATTEMPTED",
          },
        },
        {
          source: PUBLIC_API_DIRECTORY_SOURCE,
          sourceLabel: PUBLIC_API_DIRECTORY_SOURCE_LABEL,
          scope: PUBLIC_API_DIRECTORY_SCOPE,
          externalSources: true,
          mode: "EXTERNAL_FALLBACK",
          fallback: "NOT_USED",
          access: "PUBLIC_NO_API_KEY",
          verification: "UNVERIFIED_EXTERNAL",
          sourceUrl: PUBLIC_API_DIRECTORY_SOURCE_URL,
          refresh: {
            policy: "ON_CATALOG_READ_IF_STALE",
            maxAgeSeconds: Math.floor(PUBLIC_DISCOVERY_RECORD_MAX_AGE_MS / 1000),
            staleRecordsExcluded: true,
            lastAttemptAt: new Date().toISOString(),
            status: "NOT_ATTEMPTED",
          },
        },
      ],
      ranking: [
        "textRelevance",
        "observationCoverage",
        "observationFreshness",
        "publicSource",
        "externalSourceFreshness",
        "externalOpenApiMetadata",
      ],
    },
    feedback: createAgentFeedback({
      status: "READY",
      code: "DISCOVERY_READY",
      summary: "Der maschinenlesbare Bond402-Discovery-Vertrag ist verfügbar.",
      nextAction: "Katalog durchsuchen und anschließend Service-Detail sowie Pre-Action-Check lesen.",
    }),
    publicResponseFields: [
      "id",
      "name",
      "url",
      "trustScore",
      "latestStatus",
      "latestCheckAt",
      "latestCheck",
      "access",
      "links",
    ],
    limits: {
      publicCatalogRequestsPerMinutePerIp: PUBLIC_RATE_LIMIT,
      publicPreActionCountsAgainstMonthlyDeveloperQuota: false,
      developerPreActionRequiresKey: true,
    },
    policy: PRE_ACTION_POLICY,
  });
});

router.post("/public/discovery/openapi", async (req, res): Promise<void> => {
  if (!(await requireExternalCheckRateLimit(req, res))) return;
  const rawUrl = req.body && typeof req.body === "object" ? req.body.url : undefined;
  if (typeof rawUrl !== "string" || rawUrl.length > 2_048) {
    sendPublicError(
      res,
      400,
      "Bitte geben Sie genau eine öffentliche HTTPS-API- oder OpenAPI-URL an.",
      "INVALID_OPENAPI_URL",
    );
    return;
  }

  const result = await discoverDirectOpenApi(rawUrl);
  if (result.status === "INVALID_INPUT") {
    sendPublicError(
      res,
      400,
      "Die direkte OpenAPI-Erkennung akzeptiert nur öffentliche HTTPS-Ziele ohne Zugangsdaten oder Query-Parameter.",
      "INVALID_OPENAPI_URL",
    );
    return;
  }
  if (result.status !== "FOUND" || !result.detail) {
    res.status(404).json({
      error: "Unter den begrenzten typischen OpenAPI-/Swagger-Pfaden wurde keine Spezifikation gefunden.",
      code: "OPENAPI_NOT_FOUND",
      attemptedPaths: result.attemptedUrls,
      feedback: createAgentFeedback({
        status: "NO_MATCH",
        code: "OPENAPI_NOT_FOUND",
        summary: "Keine unterstützte OpenAPI- oder Swagger-Spezifikation wurde gefunden.",
        nextAction: "Eine bekannte HTTPS-Specification-URL explizit angeben; es wurde kein weiterer Scan durchgeführt.",
        source: "DIRECT_OPENAPI_URL",
        verification: "UNVERIFIED_EXTERNAL",
        httpStatus: 404,
      }),
    });
    return;
  }

  const detail = result.detail;
  rememberExternalApiDetail(detail);
  const feedbackStatus =
    detail.specification.auth.status === "REQUIRED"
      ? "AUTH_REQUIRED" as const
      : detail.specification.endpoints.length > 0 && detail.safeEndpoints.length === 0
        ? "PARAMETER_REQUIRED" as const
        : "UNVERIFIED_EXTERNAL" as const;
  const feedback = createAgentFeedback({
    status: feedbackStatus,
    code: feedbackStatus,
    summary:
      feedbackStatus === "AUTH_REQUIRED"
        ? "Die erkannte Spezifikation verlangt Authentifizierung; Bond402 hat keine Credentials verwendet."
        : feedbackStatus === "PARAMETER_REQUIRED"
          ? "Die Spezifikation enthält keine sicher parameterfreien öffentlichen GET/HEAD-Kandidaten."
          : "Die Spezifikation wurde direkt erkannt, ist aber noch nicht durch Bond402 verifiziert.",
    nextAction:
      feedbackStatus === "AUTH_REQUIRED"
        ? "Owner-gebundene Credentials nur über den geschützten Developer-Flow verwenden."
        : feedbackStatus === "PARAMETER_REQUIRED"
          ? "Keine Pfad- oder Request-Parameter raten; einen expliziten sicheren Read-Endpoint auswählen."
          : "Specification prüfen und externe Ergebnisse als unverifiziert behandeln.",
    serviceId: detail.id,
    serviceName: detail.name,
    provider: detail.provider,
    source: detail.source.id,
    verification: detail.verification.status,
    requiredAuth: detail.specification.auth.status === "REQUIRED",
  });
  res.json({ ...detail, feedback });
});

router.get("/public/services", async (req, res): Promise<void> => {
  if (!(await requirePublicRateLimit(req, res))) return;
  const parsed = parseCatalogQuery(req.query);
  if (!parsed) {
    res.status(400).json({
      error: "Ungültige Such- oder Seitengröße.",
      code: "INVALID_QUERY",
    });
    return;
  }
  const { q, page, pageSize } = parsed;
  const conditions = [
    eq(apiServicesTable.visibility, "LISTED"),
    eq(apiServicesTable.securityStatus, PUBLIC_SERVICE_SECURITY_STATUS),
    ...(q ? [or(ilike(apiServicesTable.name, `%${q}%`), ilike(apiServicesTable.url, `%${q}%`))] : []),
  ];
  const where = and(...conditions);
  const services = await db
    .select()
    .from(apiServicesTable)
    .where(where);
  const persistedDiscoveryRecords = await loadPublicDiscoveryRecords();
  const publicServices = await Promise.all(
    services.map(async (service) => toPublicServiceResponse(service, await loadChecks(service.id))),
  );
  const rankedServices = rankPublicServiceResults(publicServices, q);
  const rankedDiscovery = rankPublicDiscoveryResults(persistedDiscoveryRecords, q);
  const publicServicesById = new Map(publicServices.map((service) => [service.id, service]));
  const rankedInternalItems = [
    ...rankedServices.map(({ id, discovery }) => {
      const service = publicServicesById.get(id);
      if (!service) throw new Error("Public search result lost its listed service.");
      return {
        id,
        item: { ...service, discovery },
        matchScore: discovery.matchScore,
        textRelevance: discovery.rankingFactors.textRelevance,
        freshness: discovery.rankingFactors.observationFreshness,
      };
    }),
    ...rankedDiscovery.map((item) => ({
      id: item.id,
      item,
      matchScore: item.discovery.matchScore,
      textRelevance: item.discovery.rankingFactors.textRelevance,
      freshness: item.discovery.rankingFactors.discoveryFreshness,
    })),
  ]
    .sort((left, right) => {
      const scoreDifference = right.matchScore - left.matchScore;
      if (scoreDifference !== 0) return scoreDifference;
      const textDifference = right.textRelevance - left.textRelevance;
      if (textDifference !== 0) return textDifference;
      const freshnessDifference = right.freshness - left.freshness;
      if (freshnessDifference !== 0) return freshnessDifference;
      return left.id.localeCompare(right.id);
    });
  const hasAdequateInternalMatch = !shouldUseExternalDiscoveryFallback(
    q,
    rankedServices,
    rankedDiscovery,
  );

  if (hasAdequateInternalMatch) {
    const items = rankedInternalItems
      .slice((page - 1) * pageSize, page * pageSize)
      .map(({ item }) => item);
    const totalCount = rankedInternalItems.length;
    res.json({
      items,
      query: q,
      page,
      pageSize,
      total: totalCount,
      hasNextPage: page * pageSize < totalCount,
      sort: "matchScore.desc,textRelevance.desc,sourceFreshness.desc,name.asc,id.asc",
      source: internalCatalogSource(),
      feedback: createAgentFeedback({
        status: "READY",
        code: "CATALOG_READY",
        summary: "Der interne Bond402-Katalog enthält verwertbare Treffer.",
        nextAction: "Service-Detail und Pre-Action-Check für den ausgewählten Treffer lesen.",
      }),
    });
    return;
  }

  const cachedApisGuruCatalog = getCachedApisGuruCatalog();
  const cachedPublicApisCatalog = getCachedPublicApisCatalog();
  const [apisGuruCatalog, publicApisCatalog] = await Promise.all([
    cachedApisGuruCatalog.status === "AVAILABLE"
      ? cachedApisGuruCatalog
      : loadApisGuruCatalog(),
    cachedPublicApisCatalog.status === "AVAILABLE"
      ? cachedPublicApisCatalog
      : loadPublicApisCatalog(),
  ]);
  const externalRecords = dedupeExternalDiscoveryRecords(
    [...apisGuruCatalog.records, ...publicApisCatalog.records],
    [
      ...publicServices.map((service) => service.url),
      ...persistedDiscoveryRecords.map((record) => record.canonicalUrl),
    ],
  );
   await refreshPublicDiscoveryRecords(
    externalRecords.map(publicDiscoveryCandidateFromExternalRecord).filter(
      (candidate): candidate is NonNullable<ReturnType<typeof publicDiscoveryCandidateFromExternalRecord>> =>
        Boolean(candidate),
     ),
     [PUBLIC_EXTERNAL_DISCOVERY_SOURCE_URL, PUBLIC_API_DIRECTORY_SOURCE_URL],
  );
  const externalResults = rankExternalDiscoveryResults(externalRecords, q);
  if (apisGuruCatalog.status === "AVAILABLE" || publicApisCatalog.status === "AVAILABLE") {
    const items = externalResults.slice((page - 1) * pageSize, page * pageSize);
    const totalCount = externalResults.length;
    res.json({
      items,
      query: q,
      page,
      pageSize,
      total: totalCount,
      hasNextPage: page * pageSize < totalCount,
      sort: "matchScore.desc,textRelevance.desc,sourceFreshness.desc,name.asc,id.asc",
      source: externalCatalogSource(apisGuruCatalog.status, publicApisCatalog.status),
      feedback: createAgentFeedback({
        status: "UNVERIFIED_EXTERNAL",
        code: "EXTERNAL_CATALOG_RESULTS",
        summary: "Die Treffer stammen aus öffentlichen Quellen und sind nicht durch Bond402 verifiziert.",
        nextAction: "Externe Metadaten prüfen und vor Aktionen den passenden Preflight/Check sicher ausführen.",
        verification: "UNVERIFIED_EXTERNAL",
        source: PUBLIC_EXTERNAL_CATALOG_SOURCE,
      }),
    });
    return;
  }

  res.json({
    items: [],
    query: q,
    page,
    pageSize,
    total: 0,
    hasNextPage: false,
    sort: "matchScore.desc,textRelevance.desc,sourceFreshness.desc,name.asc,id.asc",
    source: internalCatalogSource("UNAVAILABLE"),
    feedback: createAgentFeedback({
      status: "PROVIDER_ERROR",
      code: "DISCOVERY_SOURCES_UNAVAILABLE",
      summary: "Interne und öffentliche Discovery-Quellen liefern aktuell keine Ergebnisse.",
      nextAction: "Später erneut versuchen; es wurde kein externer Treffer als verifiziert ausgegeben.",
    }),
  });
});

router.get("/public/services/:id", async (req, res): Promise<void> => {
  if (!(await requirePublicRateLimit(req, res))) return;
  const serviceId = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
  const persistedDiscovery = await loadPublicDiscoveryRecord(serviceId);
  if (persistedDiscovery) {
    const [item] = rankPublicDiscoveryResults([persistedDiscovery], "");
    res.json({
      ...item,
      feedback: createAgentFeedback({
        status: "UNVERIFIED_EXTERNAL",
        code: "PERSISTED_EXTERNAL_DISCOVERY",
        summary: "Der Treffer stammt aus persistierten öffentlichen Metadaten und ist nicht Bond402-verifiziert.",
        nextAction: "Metadaten prüfen und vor einer Aktion den sicheren externen Preflight nutzen.",
        serviceId: item.id,
        serviceName: item.name,
        source: item.discovery.source,
        verification: item.verification.status,
      }),
    });
    return;
  }
  const externalDetail = await getExternalApiDetail(serviceId);
  if (externalDetail) {
    res.json({
      ...externalDetail,
      feedback: createAgentFeedback({
        status: "UNVERIFIED_EXTERNAL",
        code: "EXTERNAL_DISCOVERY_DETAIL",
        summary: "Die Spezifikation stammt aus einer externen Quelle und ist nicht Bond402-verifiziert.",
        nextAction: "Spezifikation prüfen; keine Credentials oder mutierenden Requests verwenden.",
        serviceId: externalDetail.id,
        serviceName: externalDetail.name,
        provider: externalDetail.provider,
        source: externalDetail.source.id,
        verification: externalDetail.verification.status,
        requiredAuth: externalDetail.specification.auth.status === "REQUIRED",
      }),
    });
    return;
  }
  const service = await loadPublicService(serviceId);
  if (!service) {
    sendPublicError(
      res,
      404,
      "Gelisteter Dienst nicht gefunden.",
      "NOT_FOUND",
      { serviceId },
    );
    return;
  }
  res.json({
    ...toPublicServiceResponse(service, await loadChecks(service.id)),
    feedback: createAgentFeedback({
      status: "READY",
      code: "SERVICE_DETAIL_READY",
      summary: "Ein gelisteter Bond402-Dienst wurde gefunden.",
      nextAction: "Den gespeicherten Pre-Action-Check für den konkreten Handlungskontext lesen.",
      serviceId: service.id,
      serviceName: service.name,
      provider: service.sourceProvider,
      source: "BOND402_INTERNAL_CATALOG",
      verification: service.securityStatus,
    }),
  });
});

router.post("/public/services/:id/external-check", async (req, res): Promise<void> => {
  if (!(await requireExternalCheckRateLimit(req, res))) return;
  const serviceId = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
  const detail = await getExternalApiDetail(serviceId);
  if (!detail) {
    sendPublicError(
      res,
      404,
      "Externer Discovery-Treffer nicht gefunden.",
      "NOT_FOUND",
      { serviceId },
    );
    return;
  }

  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const method = body.method;
  const path = body.path;
  const url = body.url;
  if (
    (method !== "GET" && method !== "HEAD") ||
    typeof path !== "string" ||
    path.length > 2_000 ||
    typeof url !== "string" ||
    url.length > 4_000
  ) {
    sendPublicError(
      res,
      400,
      "Bitte wählen Sie ein gültiges, öffentliches GET/HEAD-Prüfziel.",
      "INVALID_EXTERNAL_ENDPOINT",
      {
        serviceId: detail.id,
        serviceName: detail.name,
        provider: detail.provider,
        source: detail.source.id,
        verification: detail.verification.status,
      },
    );
    return;
  }

  const candidate = detail.safeEndpoints.find(
    (entry) => entry.method === method && entry.path === path && entry.url === url,
  );
  if (!candidate) {
    sendPublicError(
      res,
      400,
      "Dieses Prüfziel wurde von Bond402 nicht als sicherer Kandidat bestätigt.",
      "UNSAFE_EXTERNAL_ENDPOINT",
      {
        serviceId: detail.id,
        serviceName: detail.name,
        provider: detail.provider,
        source: detail.source.id,
        verification: detail.verification.status,
      },
    );
    return;
  }

  const outcome = await runLiveVerification(
    candidate.url,
    "",
    3_000,
    { requestMethod: candidate.method },
    "HTTP",
  );
  res.json({
    serviceId: detail.id,
    endpoint: candidate,
    verification: {
      status: "CHECKED_EXTERNAL",
      trustStatus: "UNVERIFIED_EXTERNAL",
      checkedAt: new Date().toISOString(),
      persisted: false,
    },
    check: {
      id: null,
      serviceId: detail.id,
      checkedAt: new Date().toISOString(),
      checkType: "LIVE",
      ...outcome,
    },
    usage: {
      countsAgainstMonthlyPlan: false,
      rateLimit: `${PUBLIC_EXTERNAL_CHECK_RATE_LIMIT}/minute/IP`,
    },
    safety: {
      requestWasReadOnly: true,
      executedMethod: candidate.method,
      secretsSent: false,
      foreignCodeExecuted: false,
      responsePersisted: false,
      note: "Der Test bewertet nur diese einzelne, explizit ausgewählte Antwort. Keine Auffälligkeit ist keine Sicherheitsgarantie.",
    },
    feedback: createAgentFeedback({
      status:
        outcome.httpStatus === 429
          ? "RATE_LIMITED"
          : outcome.httpStatus !== null && outcome.httpStatus >= 500
            ? "PROVIDER_ERROR"
            : "UNVERIFIED_EXTERNAL",
      code:
        outcome.httpStatus === 429
          ? "EXTERNAL_RATE_LIMITED"
          : outcome.httpStatus !== null && outcome.httpStatus >= 500
            ? "EXTERNAL_PROVIDER_ERROR"
            : "EXTERNAL_CHECK_UNVERIFIED",
      summary:
        outcome.httpStatus === 429
          ? "Der externe Anbieter hat die Anfrage rate-limitiert."
          : outcome.httpStatus !== null && outcome.httpStatus >= 500
            ? "Der externe Anbieter meldete einen Serverfehler."
            : "Die externe Antwort wurde beobachtet, bleibt aber unverifiziert.",
      nextAction: outcome.httpStatus === 429
        ? "Später erneut versuchen und die Anbietergrenzen beachten."
        : "Bond402-Ergebnis nicht als Sicherheitsgarantie interpretieren.",
      serviceId: detail.id,
      serviceName: detail.name,
      provider: detail.provider,
      source: detail.source.id,
      verification: "UNVERIFIED_EXTERNAL",
      httpStatus: outcome.httpStatus,
    }),
  });
});

router.post("/public/services/:id/external-preflight", async (req, res): Promise<void> => {
  if (!(await requireExternalCheckRateLimit(req, res))) return;
  const serviceId = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
  const detail = await getExternalApiDetail(serviceId);
  if (!detail) {
    sendPublicError(
      res,
      404,
      "Externer Discovery-Treffer nicht gefunden.",
      "NOT_FOUND",
      { serviceId },
    );
    return;
  }

  const requestedServer = req.body && typeof req.body.serverUrl === "string"
    ? req.body.serverUrl
    : detail.specification.servers.find((server) => !server.templated && server.url.startsWith("https://"))?.url;
  const server = detail.specification.servers.find(
    (candidate) =>
      candidate.url === requestedServer &&
      !candidate.templated &&
      candidate.url.startsWith("https://"),
  );

  if (!server) {
    res.json({
      serviceId: detail.id,
      mode: "PASSIVE_ONLY",
      serverUrl: null,
      verification: {
        status: "CHECKED_EXTERNAL",
        trustStatus: "UNVERIFIED_EXTERNAL",
        checkedAt: new Date().toISOString(),
        persisted: false,
      },
      check: {
        status: "REVIEW",
        classification: "CHECK_NOT_APPLICABLE",
        availabilityImpact: "NOT_EVALUATED",
        summary: "Es wurde kein sicherer HTTPS-Server aus der Spezifikation gefunden. Es wurde kein Netzwerkziel aufgerufen.",
        reachable: false,
        responseTimeMs: 0,
        httpStatus: null,
        errorCode: "NO_SAFE_SERVER",
        https: false,
        tlsStatus: "NOT_EVALUATED",
        securitySignals: {
          classification: "CHECK_NOT_APPLICABLE",
          availabilityImpact: "NOT_EVALUATED",
          reachability: { status: "UNKNOWN", summary: "Kein sicher ableitbarer Server vorhanden." },
          transport: { status: "UNKNOWN", summary: "HTTPS/TLS konnte nicht geprüft werden." },
          network: { status: "UNKNOWN", summary: "Kein Netzwerkziel wurde aufgerufen." },
          redirects: { status: "UNKNOWN", summary: "Keine Redirect-Kette wurde geprüft." },
          responseType: { status: "UNKNOWN", summary: "Keine Antwort empfangen." },
          suspiciousPayload: { status: "UNKNOWN", summary: "Keine Antwort-Heuristiken ausgeführt.", indicators: [] },
          securityHeaders: { status: "UNKNOWN", summary: "Keine Response-Header empfangen." },
          securityConfidence: { status: "UNKNOWN", score: null, summary: "Keine ausreichenden Beobachtungen vorhanden." },
          authentication: { status: "UNKNOWN", summary: "Keine Authentifizierung geprüft.", required: detail.specification.auth.status === "REQUIRED" },
          rateLimit: { status: "UNKNOWN", summary: "Kein Rate-Limit geprüft.", detected: false },
          reputation: { status: "UNKNOWN", summary: "Keine verlässliche Reputation-Quelle konfiguriert." },
          threatIndicators: { status: "UNKNOWN", severity: "LOW", confidence: 0, indicators: [], summary: "Keine Antwort-Heuristiken ausgeführt." },
          historicalDrift: { status: "UNKNOWN", indicators: [], summary: "Keine gespeicherte externe Beobachtung vorhanden." },
        },
      },
      safety: {
        requestWasReadOnly: true,
        executedMethod: null,
        authenticatedRequest: false,
        secretsSent: false,
        foreignCodeExecuted: false,
        responsePersisted: false,
        note: "Dies war nur ein passiver Preflight. Kein authentifizierter API-Funktionsaufruf wurde durchgeführt.",
      },
      usage: {
        countsAgainstMonthlyPlan: false,
        rateLimit: `${PUBLIC_EXTERNAL_CHECK_RATE_LIMIT}/minute/IP`,
      },
      feedback: createAgentFeedback({
        status: "BLOCKED",
        code: "NO_SAFE_SERVER",
        summary: "Es wurde kein sicherer HTTPS-Server für einen externen Preflight gefunden.",
        nextAction: "Keine URL raten oder aufrufen; eine explizit deklarierte öffentliche HTTPS-Server-URL prüfen.",
        serviceId: detail.id,
        serviceName: detail.name,
        provider: detail.provider,
        source: detail.source.id,
        verification: "UNVERIFIED_EXTERNAL",
      }),
    });
    return;
  }

  const outcome = await runLiveVerification(
    server.url,
    "",
    3_000,
    { requestMethod: "HEAD" },
    "HTTP",
  );
  res.json({
    serviceId: detail.id,
    mode: "PREFLIGHT",
    serverUrl: server.url,
    verification: {
      status: "CHECKED_EXTERNAL",
      trustStatus: "UNVERIFIED_EXTERNAL",
      checkedAt: new Date().toISOString(),
      persisted: false,
    },
    check: {
      id: null,
      serviceId: detail.id,
      checkedAt: new Date().toISOString(),
      checkType: "PREFLIGHT",
      ...outcome,
    },
    safety: {
      requestWasReadOnly: true,
      executedMethod: "HEAD",
      authenticatedRequest: false,
      secretsSent: false,
      foreignCodeExecuted: false,
      responsePersisted: false,
      note: detail.specification.auth.status === "REQUIRED"
        ? "Es wurde nur ein nicht authentifizierter HEAD-Preflight am bekannten Server ausgeführt. Kein authentifizierter API-Funktionsaufruf wurde durchgeführt, weil die Spezifikation Authentifizierung verlangt."
        : "Es wurde nur ein nicht authentifizierter HEAD-Preflight am bekannten Server ausgeführt. Kein API-Funktionsaufruf und kein Secret wurden verwendet.",
    },
    usage: {
      countsAgainstMonthlyPlan: false,
      rateLimit: `${PUBLIC_EXTERNAL_CHECK_RATE_LIMIT}/minute/IP`,
    },
    feedback: createAgentFeedback({
      status: detail.specification.auth.status === "REQUIRED" ? "AUTH_REQUIRED" : "UNVERIFIED_EXTERNAL",
      code: detail.specification.auth.status === "REQUIRED"
        ? "EXTERNAL_AUTH_REQUIRED"
        : "EXTERNAL_PREFLIGHT_UNVERIFIED",
      summary: detail.specification.auth.status === "REQUIRED"
        ? "Der Server wurde nur passiv und ohne Credentials vorgeprüft; die Spezifikation verlangt Authentifizierung."
        : "Der externe Server wurde nur passiv vorgeprüft und bleibt unverifiziert.",
      nextAction: detail.specification.auth.status === "REQUIRED"
        ? "Keine öffentlichen Credentials verwenden; Owner-gebundene Authentifizierung ist erforderlich."
        : "Preflight nicht als Sicherheitsgarantie interpretieren.",
      serviceId: detail.id,
      serviceName: detail.name,
      provider: detail.provider,
      source: detail.source.id,
      verification: "UNVERIFIED_EXTERNAL",
      requiredAuth: detail.specification.auth.status === "REQUIRED",
      httpStatus: outcome.httpStatus,
    }),
  });
});

async function handlePublicPreActionCheck(req: Request, res: Response, bodyContext?: unknown) {
  if (!(await requirePublicRateLimit(req, res))) return;
  const serviceId = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
  const service = await loadPublicService(serviceId);
  if (!service) {
    sendPublicError(
      res,
      404,
      "Gelisteter Dienst nicht gefunden.",
      "NOT_FOUND",
      { serviceId },
    );
    return;
  }
  const contextValue =
    bodyContext ??
    (typeof req.query.actionContext === "string" ? req.query.actionContext : "GENERAL");
  if (
    typeof contextValue !== "string" ||
    !validActionContexts.includes(contextValue as (typeof validActionContexts)[number])
  ) {
    res.status(400).json({
      error: "Ungültiger actionContext.",
      code: "INVALID_ACTION_CONTEXT",
      feedback: feedbackForHttpError(400, "INVALID_ACTION_CONTEXT", "Ungültiger actionContext.", {
        serviceId: service.id,
        serviceName: service.name,
        provider: service.sourceProvider,
        source: "BOND402_INTERNAL_CATALOG",
        verification: service.securityStatus,
      }),
    });
    return;
  }
  const checks = await loadChecks(service.id);
  const evaluated = evaluatePreAction(service, checks, contextValue as ActionContext);
  res.json({
    serviceId: service.id,
    serviceName: service.name,
    ...evaluated,
    feedback: feedbackForDecision(evaluated.decision, {
      serviceId: service.id,
      serviceName: service.name,
      provider: service.sourceProvider,
      source: "BOND402_INTERNAL_CATALOG",
      verification: service.securityStatus,
      actionContext: evaluated.actionContext,
    }),
    access: {
      requiresDeveloperKey: false,
      liveCheckRequiresDeveloperKey: true,
    },
    usage: {
      countsAgainstMonthlyPlan: false,
      rateLimit: `${PUBLIC_RATE_LIMIT}/minute/IP`,
    },
  });
}

router.get("/public/services/:id/pre-action-check", (req, res): Promise<void> =>
  handlePublicPreActionCheck(req, res),
);

router.post("/public/services/:id/pre-action-check", (req, res): Promise<void> =>
  handlePublicPreActionCheck(
    req,
    res,
    req.body && typeof req.body === "object" ? req.body.actionContext : undefined,
  ),
);

export default router;