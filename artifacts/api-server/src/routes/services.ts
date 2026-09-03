import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  apiChecksTable,
  apiServicesTable,
  db,
  type ApiCheckRow,
  type ApiServiceRow,
} from "@workspace/db";
import {
  CreateServiceBody,
  CreateServiceResponse,
  DeleteServiceParams,
  GetDashboardResponse,
  GetServiceParams,
  GetServiceResponse,
  ListDemoServicesResponse,
  ListServicesResponse,
  RunServiceCheckParams,
  RunServiceCheckResponse,
  VerifyServiceResponseBody,
  VerifyServiceResponseParams,
  VerifyServiceResponseResponse,
} from "@workspace/api-zod";
import {
  runLiveVerification,
  runManualVerification,
  validatePublicUrl,
  type VerificationOutcome,
} from "../lib/api-verifier";

const router: IRouter = Router();

const DEMO_SERVICES = [
  {
    name: "JSONPlaceholder – Beispielbeitrag",
    url: "https://jsonplaceholder.typicode.com/posts/1",
    expectedStructure: "userId, id, title, body",
    maxResponseTime: 2000,
    explanation: "Ein öffentlicher Testdienst mit einer kleinen, vorhersehbaren JSON-Antwort.",
  },
  {
    name: "GitHub – öffentlicher Status",
    url: "https://www.githubstatus.com/api/v2/status.json",
    expectedStructure: "page, status",
    maxResponseTime: 2500,
    explanation: "Ein öffentlicher Status-Endpunkt von GitHub. Es werden keine Zugangsdaten benötigt.",
  },
  {
    name: "JSONPlaceholder – Beispielnutzer",
    url: "https://jsonplaceholder.typicode.com/users/1",
    expectedStructure: "id, name, username, email, address",
    maxResponseTime: 2000,
    explanation: "Ein zweiter öffentlicher Testdienst mit verschachtelten Beispieldaten.",
  },
];

function toCheckResponse(check: ApiCheckRow) {
  return {
    id: check.id,
    serviceId: check.serviceId,
    checkedAt: check.checkedAt.toISOString(),
    status: check.status as "PASS" | "FAIL" | "REVIEW",
    checkType: check.checkType as "LIVE" | "MANUAL",
    reachable: check.reachable,
    responseTimeMs: check.responseTimeMs,
    structureMatch: check.structureMatch,
    httpStatus: check.httpStatus,
    errorCode: check.errorCode,
    summary: check.summary,
    foundFields: check.foundFields,
    missingFields: check.missingFields,
  };
}

function calculateTrust(checks: ApiCheckRow[], maxResponseTime: number) {
  const liveChecks = checks.filter((check) => check.checkType === "LIVE");
  if (liveChecks.length === 0) {
    return {
      score: null,
      explanation: "Noch keine echte Prüfung vorhanden. Starten Sie einen Live-Check.",
    };
  }

  const ratio = (count: number) => count / liveChecks.length;
  const reachability = ratio(liveChecks.filter((check) => check.reachable).length);
  const performance = ratio(
    liveChecks.filter(
      (check) => check.reachable && check.responseTimeMs > 0 && check.responseTimeMs <= maxResponseTime,
    ).length,
  );
  const structure = ratio(liveChecks.filter((check) => check.structureMatch).length);
  const reliability = ratio(
    liveChecks.filter((check) => check.status === "PASS").length,
  );
  const score = Math.round(
    reachability * 40 + performance * 25 + structure * 25 + reliability * 10,
  );
  const explanation =
    `Berechnung aus ${liveChecks.length} echten Prüfungen: ` +
    `Erreichbarkeit ${Math.round(reachability * 100)} % (40 Punkte), ` +
    `Antwortzeit ${Math.round(performance * 100)} % (25 Punkte), ` +
    `Strukturtreue ${Math.round(structure * 100)} % (25 Punkte) und ` +
    `fehlerfreie PASS-Prüfungen ${Math.round(reliability * 100)} % (10 Punkte).`;
  return { score, explanation };
}

async function loadChecks(serviceId: string) {
  return db
    .select()
    .from(apiChecksTable)
    .where(eq(apiChecksTable.serviceId, serviceId))
    .orderBy(desc(apiChecksTable.checkedAt));
}

async function toServiceResponse(service: ApiServiceRow) {
  const checks = await loadChecks(service.id);
  const trust = calculateTrust(checks, service.maxResponseTime);
  return {
    id: service.id,
    name: service.name,
    url: service.url,
    expectedStructure: service.expectedStructure,
    maxResponseTime: service.maxResponseTime,
    createdAt: service.createdAt.toISOString(),
    trustScore: trust.score,
    trustExplanation: trust.explanation,
    checks: checks.map(toCheckResponse),
  };
}

async function findService(id: string) {
  const [service] = await db
    .select()
    .from(apiServicesTable)
    .where(eq(apiServicesTable.id, id));
  return service;
}

async function saveOutcome(
  serviceId: string,
  checkType: "LIVE" | "MANUAL",
  outcome: VerificationOutcome,
) {
  const [check] = await db
    .insert(apiChecksTable)
    .values({
      id: crypto.randomUUID(),
      serviceId,
      checkType,
      ...outcome,
    })
    .returning();
  return check;
}

router.get("/services", async (_req, res): Promise<void> => {
  const services = await db
    .select()
    .from(apiServicesTable)
    .orderBy(desc(apiServicesTable.createdAt));
  const response = await Promise.all(services.map(toServiceResponse));
  res.json(ListServicesResponse.parse(response));
});

router.post("/services", async (req, res): Promise<void> => {
  const parsed = CreateServiceBody.safeParse(req.body);
  const normalizedName = parsed.success ? parsed.data.name.trim() : "";
  const normalizedStructure = parsed.success
    ? parsed.data.expectedStructure.trim()
    : "";
  if (
    !parsed.success ||
    !Number.isInteger(parsed.data.maxResponseTime) ||
    normalizedName.length < 2 ||
    normalizedStructure.length === 0
  ) {
    res.status(400).json({ error: "Bitte prüfen Sie alle Eingaben.", code: "INVALID_INPUT" });
    return;
  }

  try {
    await validatePublicUrl(parsed.data.url);
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "INVALID_URL";
    res.status(400).json({
      error: error instanceof Error ? error.message : "Die URL ist ungültig.",
      code,
    });
    return;
  }

  const [service] = await db
    .insert(apiServicesTable)
    .values({
      id: crypto.randomUUID(),
      name: normalizedName,
      url: parsed.data.url,
      expectedStructure: normalizedStructure,
      maxResponseTime: parsed.data.maxResponseTime,
    })
    .returning();
  res.status(201).json(CreateServiceResponse.parse(await toServiceResponse(service)));
});

router.get("/services/:id", async (req, res): Promise<void> => {
  const params = GetServiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Ungültige Dienst-ID.", code: "INVALID_ID" });
    return;
  }
  const service = await findService(params.data.id);
  if (!service) {
    res.status(404).json({ error: "Dienst nicht gefunden.", code: "NOT_FOUND" });
    return;
  }
  res.json(GetServiceResponse.parse(await toServiceResponse(service)));
});

router.delete("/services/:id", async (req, res): Promise<void> => {
  const params = DeleteServiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Ungültige Dienst-ID.", code: "INVALID_ID" });
    return;
  }
  const deleted = await db
    .delete(apiServicesTable)
    .where(eq(apiServicesTable.id, params.data.id))
    .returning({ id: apiServicesTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Dienst nicht gefunden.", code: "NOT_FOUND" });
    return;
  }
  res.sendStatus(204);
});

router.post("/services/:id/checks", async (req, res): Promise<void> => {
  const params = RunServiceCheckParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Ungültige Dienst-ID.", code: "INVALID_ID" });
    return;
  }
  const service = await findService(params.data.id);
  if (!service) {
    res.status(404).json({ error: "Dienst nicht gefunden.", code: "NOT_FOUND" });
    return;
  }
  const outcome = await runLiveVerification(
    service.url,
    service.expectedStructure,
    service.maxResponseTime,
  );
  const check = await saveOutcome(service.id, "LIVE", outcome);
  res.status(201).json(RunServiceCheckResponse.parse(toCheckResponse(check)));
});

router.post("/services/:id/verify", async (req, res): Promise<void> => {
  const params = VerifyServiceResponseParams.safeParse(req.params);
  const body = VerifyServiceResponseBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Bitte fügen Sie eine gültige Antwort ein.", code: "INVALID_INPUT" });
    return;
  }
  const service = await findService(params.data.id);
  if (!service) {
    res.status(404).json({ error: "Dienst nicht gefunden.", code: "NOT_FOUND" });
    return;
  }
  const outcome = runManualVerification(service.expectedStructure, body.data.actualResponse);
  const check = await saveOutcome(service.id, "MANUAL", outcome);
  res.status(201).json(VerifyServiceResponseResponse.parse(toCheckResponse(check)));
});

router.get("/dashboard", async (_req, res): Promise<void> => {
  const services = await db.select().from(apiServicesTable);
  const checks = await db.select().from(apiChecksTable);
  const liveChecks = checks.filter((check) => check.checkType === "LIVE");
  const timedChecks = liveChecks.filter((check) => check.responseTimeMs > 0);
  const passRate =
    liveChecks.length === 0
      ? 0
      : Math.round(
          (liveChecks.filter((check) => check.status === "PASS").length / liveChecks.length) *
            100,
        );
  const averageResponseTimeMs =
    timedChecks.length === 0
      ? 0
      : Math.round(
          timedChecks.reduce((sum, check) => sum + check.responseTimeMs, 0) /
            timedChecks.length,
        );
  res.json(
    GetDashboardResponse.parse({
      serviceCount: services.length,
      checkCount: checks.length,
      passRate,
      averageResponseTimeMs,
    }),
  );
});

router.get("/demo-services", (_req, res): void => {
  res.json(ListDemoServicesResponse.parse(DEMO_SERVICES));
});

export default router;