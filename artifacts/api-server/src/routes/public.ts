import { Router, type IRouter, type Request, type Response } from "express";
import { and, count, eq, ilike, or } from "drizzle-orm";
import { apiServicesTable, db } from "@workspace/db";
import { consumePublicRateLimit } from "../lib/api-key-auth";
import {
  PUBLIC_DISCOVERY_SOURCE,
  PUBLIC_DISCOVERY_SOURCE_LABEL,
  rankPublicServiceResults,
} from "../lib/public-service-search";
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

async function loadListedService(id: string) {
  const [service] = await db
    .select()
    .from(apiServicesTable)
    .where(and(eq(apiServicesTable.id, id), eq(apiServicesTable.visibility, "LISTED")));
  return service;
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
      ranking: [
        "textRelevance",
        "observationCoverage",
        "observationFreshness",
        "publicSource",
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
    source: {
      source: PUBLIC_DISCOVERY_SOURCE,
      sourceLabel: PUBLIC_DISCOVERY_SOURCE_LABEL,
      scope: "LISTED_SERVICES_ONLY",
      externalSources: false,
    },
  });
});

router.get("/public/services/:id", async (req, res): Promise<void> => {
  if (!(await requirePublicRateLimit(req, res))) return;
  const serviceId = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
  const service = await loadListedService(serviceId);
  if (!service) {
    res.status(404).json({ error: "Gelisteter Dienst nicht gefunden.", code: "NOT_FOUND" });
    return;
  }
  res.json(toPublicServiceResponse(service, await loadChecks(service.id)));
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