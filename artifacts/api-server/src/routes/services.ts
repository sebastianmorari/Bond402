import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  apiChecksTable,
  apiServicesTable,
  db,
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
  hashDomainVerificationToken,
  verifyDomainChallenge,
  validatePublicUrl,
} from "../lib/api-verifier";
import {
  findOwnedService,
  calculateTrustMetrics,
  saveOutcome,
  toCheckResponse,
  toServiceResponse,
} from "../lib/service-data";
import { requireUserId } from "../lib/auth";
import { requireCheckQuota } from "../lib/quota";

const router: IRouter = Router();

function publicUrlErrorMessage(code: string) {
  if (code === "UNSAFE_URL") {
    return "Nur öffentliche HTTP- oder HTTPS-Adressen ohne Zugangsdaten sind erlaubt.";
  }
  if (code === "PRIVATE_ADDRESS") {
    return "Private oder interne Adressen dürfen nicht geprüft werden.";
  }
  return "Die URL ist ungültig.";
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

router.get("/services", async (req, res): Promise<void> => {
  const userId = await requireUserId(req, res);
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
  const userId = await requireUserId(req, res);
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
      error: publicUrlErrorMessage(code),
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
      visibility: "PRIVATE",
    })
    .returning();
  res.status(201).json(CreateServiceResponse.parse(await toServiceResponse(service)));
});

router.get("/services/:id", async (req, res): Promise<void> => {
  const userId = await requireUserId(req, res);
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
  const userId = await requireUserId(req, res);
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
  if (body.data.visibility !== undefined) {
    changes.visibility = body.data.visibility;
  }
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
        error: publicUrlErrorMessage(code),
        code,
      });
      return;
    }
  }

  const [service] = await db
    .update(apiServicesTable)
    .set({
      ...changes,
      ...(body.data.visibility === "LISTED"
        ? { listedAt: new Date() }
        : body.data.visibility === "PRIVATE"
          ? { listedAt: null }
          : {}),
    })
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
  const userId = await requireUserId(req, res);
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
  const userId = await requireUserId(req, res);
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
  if (!(await requireCheckQuota(userId, res))) return;
  const outcome = await runLiveVerification(
    service.url,
    service.expectedStructure,
    service.maxResponseTime,
  );
  const check = await saveOutcome(service.id, "LIVE", outcome);
  res.status(201).json(RunServiceCheckResponse.parse(toCheckResponse(check)));
});

router.post("/services/:id/verify", async (req, res): Promise<void> => {
  const userId = await requireUserId(req, res);
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
  if (!(await requireCheckQuota(userId, res))) return;
  const outcome = runManualVerification(service.expectedStructure, body.data.actualResponse);
  const check = await saveOutcome(service.id, "MANUAL", outcome);
  res.status(201).json(VerifyServiceResponseResponse.parse(toCheckResponse(check)));
});

router.post("/services/:id/domain-verification", async (req, res): Promise<void> => {
  const userId = await requireUserId(req, res);
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
  const token = `bond402_${crypto.randomUUID()}`;
  const [updated] = await db
    .update(apiServicesTable)
    .set({
      domainVerificationTokenHash: hashDomainVerificationToken(token),
      domainVerificationIssuedAt: new Date(),
      domainVerifiedAt: null,
    })
    .where(and(eq(apiServicesTable.id, service.id), eq(apiServicesTable.ownerId, userId)))
    .returning();
  res.json({
    status: "PENDING",
    token,
    path: "/.well-known/bond402-verification.txt",
    instructions:
      "Legen Sie den Token als reinen Text unter der angegebenen HTTPS-Well-Known-Adresse ab und starten Sie danach die Verifizierung.",
    issuedAt: updated.domainVerificationIssuedAt?.toISOString() ?? new Date().toISOString(),
  });
});

router.post("/services/:id/domain-verification/check", async (req, res): Promise<void> => {
  const userId = await requireUserId(req, res);
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
  if (!service.domainVerificationTokenHash) {
    res.status(400).json({
      error: "Bitte erzeugen Sie zuerst einen Domain-Verifizierungstoken.",
      code: "VERIFICATION_NOT_STARTED",
    });
    return;
  }
  const result = await verifyDomainChallenge(service.url, service.domainVerificationTokenHash);
  const [updated] = result.verified
    ? await db
        .update(apiServicesTable)
        .set({ domainVerifiedAt: new Date() })
        .where(and(eq(apiServicesTable.id, service.id), eq(apiServicesTable.ownerId, userId)))
        .returning()
    : [service];
  res.json({
    status: result.verified ? "VERIFIED" : "PENDING",
    verifiedAt: updated.domainVerifiedAt?.toISOString() ?? null,
    reason: result.reason,
  });
});

router.get("/dashboard", async (req, res): Promise<void> => {
  const userId = await requireUserId(req, res);
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
  const aggregateMetrics = calculateTrustMetrics(liveChecks, 15000);
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
      uptimePercent: aggregateMetrics.uptimePercent,
      p95ResponseTimeMs: aggregateMetrics.p95ResponseTimeMs,
      p99ResponseTimeMs: aggregateMetrics.p99ResponseTimeMs,
      timedSampleCount: aggregateMetrics.timedSampleCount,
    }),
  );
});

router.get("/demo-services", (_req, res): void => {
  res.json(ListDemoServicesResponse.parse(DEMO_SERVICES));
});

export default router;