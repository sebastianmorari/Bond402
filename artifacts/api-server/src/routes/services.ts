import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, desc, eq, inArray } from "drizzle-orm";
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
  UpdateServiceBody,
  UpdateServiceParams,
  UpdateServiceResponse,
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

function requireUserId(req: Request, res: Response): string | null {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({
      error: "Bitte melden Sie sich an, um Ihre Dienste zu verwalten.",
      code: "UNAUTHORIZED",
    });
    return null;
  }
  return userId;
}

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

async function findOwnedService(id: string, ownerId: string) {
  const [service] = await db
    .select()
    .from(apiServicesTable)
    .where(and(eq(apiServicesTable.id, id), eq(apiServicesTable.ownerId, ownerId)));
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

router.get("/services", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const services = await db
    .select()
    .from(apiServicesTable)
    .where(eq(apiServicesTable.ownerId, userId))
    .orderBy(desc(apiServicesTable.createdAt));
  const response = await Promise.all(services.map(toServiceResponse));
  res.json(ListServicesResponse.parse(response));
});

router.post("/services", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
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
      ownerId: userId,
      name: normalizedName,
      url: parsed.data.url,
      expectedStructure: normalizedStructure,
      maxResponseTime: parsed.data.maxResponseTime,
    })
    .returning();
  res.status(201).json(CreateServiceResponse.parse(await toServiceResponse(service)));
});

router.get("/services/:id", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const params = GetServiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Ungültige Dienst-ID.", code: "INVALID_ID" });
    return;
  }
  const service = await findOwnedService(params.data.id, userId);
  if (!service) {
    res.status(404).json({ error: "Dienst nicht gefunden.", code: "NOT_FOUND" });
    return;
  }
  res.json(GetServiceResponse.parse(await toServiceResponse(service)));
});

router.patch("/services/:id", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const params = UpdateServiceParams.safeParse(req.params);
  const body = UpdateServiceBody.safeParse(req.body);
  if (!params.success || !body.success || Object.keys(body.data).length === 0) {
    res.status(400).json({ error: "Bitte prüfen Sie die Änderungen.", code: "INVALID_INPUT" });
    return;
  }

  const changes = {
    ...body.data,
    ...(body.data.name !== undefined ? { name: body.data.name.trim() } : {}),
    ...(body.data.expectedStructure !== undefined
      ? { expectedStructure: body.data.expectedStructure.trim() }
      : {}),
  };
  if (changes.name !== undefined && changes.name.length < 2) {
    res.status(400).json({ error: "Der Dienstname ist zu kurz.", code: "INVALID_INPUT" });
    return;
  }
  if (changes.expectedStructure !== undefined && changes.expectedStructure.length === 0) {
    res.status(400).json({ error: "Die erwartete Struktur darf nicht leer sein.", code: "INVALID_INPUT" });
    return;
  }
  if (changes.maxResponseTime !== undefined && !Number.isInteger(changes.maxResponseTime)) {
    res.status(400).json({ error: "Die Antwortzeit muss eine ganze Zahl sein.", code: "INVALID_INPUT" });
    return;
  }
  if (changes.url !== undefined) {
    try {
      await validatePublicUrl(changes.url);
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
  }

  const [service] = await db
    .update(apiServicesTable)
    .set(changes)
    .where(
      and(
        eq(apiServicesTable.id, params.data.id),
        eq(apiServicesTable.ownerId, userId),
      ),
    )
    .returning();
  if (!service) {
    res.status(404).json({ error: "Dienst nicht gefunden.", code: "NOT_FOUND" });
    return;
  }
  res.json(UpdateServiceResponse.parse(await toServiceResponse(service)));
});

router.delete("/services/:id", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const params = DeleteServiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Ungültige Dienst-ID.", code: "INVALID_ID" });
    return;
  }
  const deleted = await db
    .delete(apiServicesTable)
    .where(
      and(
        eq(apiServicesTable.id, params.data.id),
        eq(apiServicesTable.ownerId, userId),
      ),
    )
    .returning({ id: apiServicesTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Dienst nicht gefunden.", code: "NOT_FOUND" });
    return;
  }
  res.sendStatus(204);
});

router.post("/services/:id/checks", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const params = RunServiceCheckParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Ungültige Dienst-ID.", code: "INVALID_ID" });
    return;
  }
  const service = await findOwnedService(params.data.id, userId);
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
  const userId = requireUserId(req, res);
  if (!userId) return;
  const params = VerifyServiceResponseParams.safeParse(req.params);
  const body = VerifyServiceResponseBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Bitte fügen Sie eine gültige Antwort ein.", code: "INVALID_INPUT" });
    return;
  }
  const service = await findOwnedService(params.data.id, userId);
  if (!service) {
    res.status(404).json({ error: "Dienst nicht gefunden.", code: "NOT_FOUND" });
    return;
  }
  const outcome = runManualVerification(service.expectedStructure, body.data.actualResponse);
  const check = await saveOutcome(service.id, "MANUAL", outcome);
  res.status(201).json(VerifyServiceResponseResponse.parse(toCheckResponse(check)));
});

router.get("/dashboard", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const services = await db
    .select()
    .from(apiServicesTable)
    .where(eq(apiServicesTable.ownerId, userId));
  const serviceIds = new Set(services.map((service) => service.id));
  const checks =
    services.length === 0
      ? []
      : await db
          .select()
          .from(apiChecksTable)
          .where(inArray(apiChecksTable.serviceId, [...serviceIds]));
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