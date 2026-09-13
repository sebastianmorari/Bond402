import { Router, type IRouter, type Request, type Response } from "express";
import { and, count, eq, ilike, or } from "drizzle-orm";
import { apiServicesTable, db } from "@workspace/db";
import { consumePublicRateLimit } from "../lib/api-key-auth";
import {
  PUBLIC_DISCOVERY_SOURCE,
  PUBLIC_DISCOVERY_SOURCE_LABEL,
  shouldUseExternalDiscoveryFallback,
  rankPublicServiceResults,
} from "../lib/public-service-search";
import {
  PUBLIC_EXTERNAL_DISCOVERY_SCOPE,
  PUBLIC_EXTERNAL_DISCOVERY_SOURCE,
  PUBLIC_EXTERNAL_DISCOVERY_SOURCE_LABEL,
  PUBLIC_EXTERNAL_DISCOVERY_SOURCE_URL,
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

async function requirePublicRateLimit(req: Request, res: Response) {
  const rate = await consumePublicRateLimit(req.ip || "unknown", "catalog", PUBLIC_RATE_LIMIT);
  if (rate.allowed) return true;
  res.set("Retry-After", String(rate.retryAfter));
  res.status(429).json({
    error: "Zu viele öffentliche Kataloganfragen. Bitte warten Sie kurz.",
    code: "RATE_LIMITED",
    retryAfterSeconds: rate.retryAfter,
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
  });
  return false;
}

async function loadListedService(id: string) {
  const [service] = await db
    .select()
    .from(apiServicesTable)
    .where(and(eq(apiServicesTable.id, id), eq(apiServicesTable.visibility, "LISTED")));
  return service;
}

function internalCatalogSource(
  fallback: "NOT_USED" | "UNAVAILABLE" = "NOT_USED",
) {
  return {
    source: PUBLIC_DISCOVERY_SOURCE,
    sourceLabel: PUBLIC_DISCOVERY_SOURCE_LABEL,
    scope: "LISTED_SERVICES_ONLY" as const,
    externalSources: false as const,
    mode: "INTERNAL_PRIMARY" as const,
    fallback,
  };
}

function externalCatalogSource() {
  return {
    source: PUBLIC_EXTERNAL_DISCOVERY_SOURCE,
    sourceLabel: PUBLIC_EXTERNAL_DISCOVERY_SOURCE_LABEL,
    scope: PUBLIC_EXTERNAL_DISCOVERY_SCOPE,
    externalSources: true as const,
    mode: "EXTERNAL_FALLBACK" as const,
    fallback: "USED" as const,
    sourceUrl: PUBLIC_EXTERNAL_DISCOVERY_SOURCE_URL,
  };
}

router.get("/openapi.json", async (req, res): Promise<void> => {
  if (!(await requirePublicRateLimit(req, res))) return;
  res.type("application/json").json(getPublicOpenApiDocument(publicBaseUrl(req)));
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
      serviceDetail: `${base}/api/public/services/{id}`,
      publicPreActionCheck: `${base}/api/public/services/{id}/pre-action-check`,
      openapi: `${base}/api/openapi.json`,
      humanDocs: `${base}/api-docs`,
      wellKnown: `${base}/.well-known/bond402-agent.json`,
      llms: `${base}/llms.txt`,
    },
    dataSource: {
      source: PUBLIC_DISCOVERY_SOURCE,
      sourceLabel: PUBLIC_DISCOVERY_SOURCE_LABEL,
      scope: "LISTED_SERVICES_ONLY",
      externalSources: false,
      fallbackPolicy:
        "Interne gelistete Bond402-Treffer zuerst; öffentliche OpenAPI-Quellen nur bei fehlender ausreichender interner Relevanz.",
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
    ...(q ? [or(ilike(apiServicesTable.name, `%${q}%`), ilike(apiServicesTable.url, `%${q}%`))] : []),
  ];
  const where = and(...conditions);
  const [{ total }] = await db
    .select({ total: count() })
    .from(apiServicesTable)
    .where(where);
  const services = await db
    .select()
    .from(apiServicesTable)
    .where(where);
  const publicServices = await Promise.all(
    services.map(async (service) => toPublicServiceResponse(service, await loadChecks(service.id))),
  );
  const rankedServices = rankPublicServiceResults(publicServices, q);
  const publicServicesById = new Map(publicServices.map((service) => [service.id, service]));
  const hasAdequateInternalMatch = !shouldUseExternalDiscoveryFallback(q, rankedServices);

  if (hasAdequateInternalMatch) {
    const items = rankedServices
      .slice((page - 1) * pageSize, page * pageSize)
      .map(({ id, discovery }) => {
        const service = publicServicesById.get(id);
        if (!service) throw new Error("Public search result lost its listed service.");
        return { ...service, discovery };
      });
    const totalCount = Number(total);
    res.json({
      items,
      query: q,
      page,
      pageSize,
      total: totalCount,
      hasNextPage: page * pageSize < totalCount,
      sort: "matchScore.desc,textRelevance.desc,observationFreshness.desc,name.asc,id.asc",
      source: internalCatalogSource(),
    });
    return;
  }

  const externalCatalog = await loadApisGuruCatalog();
  const externalResults = rankExternalDiscoveryResults(externalCatalog.records, q);
  if (externalCatalog.status === "AVAILABLE") {
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
      source: externalCatalogSource(),
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
  });
});

router.get("/public/services/:id", async (req, res): Promise<void> => {
  if (!(await requirePublicRateLimit(req, res))) return;
  const serviceId = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
  const externalDetail = await getExternalApiDetail(serviceId);
  if (externalDetail) {
    res.json(externalDetail);
    return;
  }
  const service = await loadListedService(serviceId);
  if (!service) {
    res.status(404).json({ error: "Gelisteter Dienst nicht gefunden.", code: "NOT_FOUND" });
    return;
  }
  res.json(toPublicServiceResponse(service, await loadChecks(service.id)));
});

router.post("/public/services/:id/external-check", async (req, res): Promise<void> => {
  if (!(await requireExternalCheckRateLimit(req, res))) return;
  const serviceId = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
  const detail = await getExternalApiDetail(serviceId);
  if (!detail) {
    res.status(404).json({ error: "Externer Discovery-Treffer nicht gefunden.", code: "NOT_FOUND" });
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
    res.status(400).json({
      error: "Bitte wählen Sie ein gültiges, öffentliches GET/HEAD-Prüfziel.",
      code: "INVALID_EXTERNAL_ENDPOINT",
    });
    return;
  }

  const candidate = detail.safeEndpoints.find(
    (entry) => entry.method === method && entry.path === path && entry.url === url,
  );
  if (!candidate) {
    res.status(400).json({
      error: "Dieses Prüfziel wurde von Bond402 nicht als sicherer Kandidat bestätigt.",
      code: "UNSAFE_EXTERNAL_ENDPOINT",
    });
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
  });
});

router.post("/public/services/:id/external-preflight", async (req, res): Promise<void> => {
  if (!(await requireExternalCheckRateLimit(req, res))) return;
  const serviceId = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
  const detail = await getExternalApiDetail(serviceId);
  if (!detail) {
    res.status(404).json({ error: "Externer Discovery-Treffer nicht gefunden.", code: "NOT_FOUND" });
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
        summary: "Es wurde kein sicherer HTTPS-Server aus der Spezifikation gefunden. Es wurde kein Netzwerkziel aufgerufen.",
        reachable: false,
        responseTimeMs: 0,
        httpStatus: null,
        errorCode: "NO_SAFE_SERVER",
        https: false,
        tlsStatus: "NOT_EVALUATED",
        securitySignals: {
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
  });
});

async function handlePublicPreActionCheck(req: Request, res: Response, bodyContext?: unknown) {
  if (!(await requirePublicRateLimit(req, res))) return;
  const serviceId = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
  const service = await loadListedService(serviceId);
  if (!service) {
    res.status(404).json({ error: "Gelisteter Dienst nicht gefunden.", code: "NOT_FOUND" });
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
    });
    return;
  }
  const checks = await loadChecks(service.id);
  const evaluated = evaluatePreAction(service, checks, contextValue as ActionContext);
  res.json({
    serviceId: service.id,
    serviceName: service.name,
    ...evaluated,
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