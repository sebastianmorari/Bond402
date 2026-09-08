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
  ListServicesResponseItem,
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
  buildServiceResponse,
  calculateTrustMetrics,
  getTargetRequestOptions,
  loadChecks,
  saveOutcome,
  toCheckResponse,
  toServiceResponse,
} from "../lib/service-data";
import { requireUserId } from "../lib/auth";
import { requireCheckQuota } from "../lib/quota";
import { runServiceCreationTransaction } from "../lib/service-creation";
import { getServiceCreationErrorResponse } from "../lib/service-errors";
import { logger } from "../lib/logger";
import {
  encryptTargetSecret,
  validateTargetAuthHeaderName,
  type TargetAuthType,
} from "../lib/target-auth";

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

function targetConfigError(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "INVALID_TARGET_CONFIGURATION";
  const messages: Record<string, string> = {
    INVALID_TARGET_AUTH: "Das Ziel-Secret ist ungültig.",
    INVALID_TARGET_AUTH_HEADER: "Der Authentifizierungs-Header ist nicht erlaubt.",
    TARGET_AUTH_CONFIGURATION: "Die Zielauthentifizierung ist unvollständig.",
    TARGET_REQUEST_CONFIGURATION: "Die Request-Konfiguration ist ungültig.",
    REQUEST_BODY_TOO_LARGE: "Der JSON-Request-Body ist zu groß.",
    TARGET_AUTH_UNAVAILABLE: "Die serverseitige Secret-Verwaltung ist vorübergehend nicht verfügbar.",
  };
  return {
    code,
    error: messages[code] ?? "Die Request-Konfiguration ist ungültig.",
    status: code === "TARGET_AUTH_UNAVAILABLE" ? 503 : 400,
  };
}

function hasField<T extends object>(value: T, field: keyof T) {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function normalizeTargetConfiguration(
  input: {
    requestMethod?: "GET" | "POST";
    targetAuthType?: TargetAuthType;
    targetAuthHeaderName?: string | null;
    targetAuthSecret?: string;
    requestBody?: Record<string, unknown> | null;
  },
  existing?: typeof apiServicesTable.$inferSelect,
) {
  const requestMethod = input.requestMethod ?? existing?.requestMethod ?? "GET";
  const targetAuthType = input.targetAuthType ?? existing?.targetAuthType ?? "NONE";
  const bodyWasProvided = hasField(input, "requestBody");
  let requestBody = bodyWasProvided
    ? input.requestBody ?? null
    : existing?.requestBody ?? null;

  if (requestMethod === "GET" && requestBody !== null) {
    if (bodyWasProvided) {
      throw Object.assign(new Error("Ein Request-Body ist nur für POST erlaubt."), {
        code: "TARGET_REQUEST_CONFIGURATION",
      });
    }
    requestBody = null;
  }

  if (targetAuthType === "NONE") {
    if (input.targetAuthSecret) {
      throw Object.assign(new Error("Ein Secret ist ohne Zielauthentifizierung nicht erlaubt."), {
        code: "TARGET_AUTH_CONFIGURATION",
      });
    }
    return {
      requestMethod,
      targetAuthType,
      targetAuthHeaderName: null,
      targetAuthSecretCiphertext: null,
      requestBody,
    };
  }

  const existingSecret = existing?.targetAuthSecretCiphertext ?? null;
  const targetAuthSecretCiphertext = input.targetAuthSecret
    ? encryptTargetSecret(input.targetAuthSecret)
    : existingSecret;
  if (!targetAuthSecretCiphertext) {
    throw Object.assign(new Error("Für diese Zielauthentifizierung ist ein Secret erforderlich."), {
      code: "TARGET_AUTH_CONFIGURATION",
    });
  }

  if (targetAuthType === "BEARER") {
    if (
      input.targetAuthHeaderName &&
      input.targetAuthHeaderName.trim().toLowerCase() !== "authorization"
    ) {
      throw Object.assign(new Error("Bearer verwendet ausschließlich Authorization."), {
        code: "INVALID_TARGET_AUTH_HEADER",
      });
    }
    return {
      requestMethod,
      targetAuthType,
      targetAuthHeaderName: null,
      targetAuthSecretCiphertext,
      requestBody,
    };
  }

  if (!input.targetAuthHeaderName && !existing?.targetAuthHeaderName) {
    throw Object.assign(new Error("Für einen API-Key-Header ist ein Header-Name erforderlich."), {
      code: "TARGET_AUTH_CONFIGURATION",
    });
  }
  return {
    requestMethod,
    targetAuthType,
    targetAuthHeaderName: validateTargetAuthHeaderName(
      input.targetAuthHeaderName ?? existing?.targetAuthHeaderName ?? "",
    ),
    targetAuthSecretCiphertext,
    requestBody,
  };
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

function getValidationFieldPaths(error: unknown): string[] {
  if (
    typeof error !== "object" ||
    error === null ||
    !("issues" in error) ||
    !Array.isArray(error.issues)
  ) {
    return [];
  }

  return error.issues.flatMap((issue: unknown) => {
    if (typeof issue !== "object" || issue === null || !("path" in issue)) {
      return [];
    }
    const path = issue.path;
    if (!Array.isArray(path)) return [];
    return [path.length > 0 ? path.map(String).join(".") : "<root>"];
  });
}

function getCheckIndexes(fieldPaths: string[]): Set<number> {
  const indexes = new Set<number>();
  for (const fieldPath of fieldPaths) {
    const match = /^checks\.(\d+)(?:\.|$)/.exec(fieldPath);
    if (match) indexes.add(Number(match[1]));
  }
  return indexes;
}

function logServiceDataIssue(
  requestId: string,
  serviceId: string,
  fieldPaths: string[],
  error?: unknown,
) {
  logger.warn(
    {
      requestId,
      serviceId,
      fieldPaths: fieldPaths.length > 0 ? fieldPaths : ["service"],
      ...(error instanceof Error ? { errorType: error.name } : {}),
    },
    "Dienst wurde wegen ungültiger Antwortdaten übersprungen oder bereinigt",
  );
}

async function toSafeListServiceResponse(
  service: Parameters<typeof buildServiceResponse>[0],
  requestId: string,
) {
  let checks;
  try {
    checks = await loadChecks(service.id);
  } catch (error) {
    logServiceDataIssue(requestId, service.id, ["checks"], error);
    return null;
  }

  const skippedCheckIndexes = new Set<number>();
  for (const [index, check] of checks.entries()) {
    try {
      toCheckResponse(check);
    } catch (error) {
      skippedCheckIndexes.add(index);
      logServiceDataIssue(requestId, service.id, [`checks.${index}`], error);
    }
  }

  const usableChecks = checks.filter((_, index) => !skippedCheckIndexes.has(index));
  let candidate;
  try {
    candidate = buildServiceResponse(service, usableChecks);
  } catch (error) {
    logServiceDataIssue(requestId, service.id, ["service"], error);
    return null;
  }

  const parsed = ListServicesResponseItem.safeParse(candidate);
  if (parsed.success) return parsed.data;

  const fieldPaths = getValidationFieldPaths(parsed.error);
  const invalidCheckIndexes = getCheckIndexes(fieldPaths);
  if (invalidCheckIndexes.size > 0) {
    const filteredChecks = usableChecks.filter(
      (_, index) => !invalidCheckIndexes.has(index),
    );
    try {
      const retry = ListServicesResponseItem.safeParse(
        buildServiceResponse(service, filteredChecks),
      );
      if (retry.success) {
        logServiceDataIssue(requestId, service.id, fieldPaths);
        return retry.data;
      }
    } catch (error) {
      logServiceDataIssue(requestId, service.id, fieldPaths, error);
      return null;
    }
  }

  logServiceDataIssue(requestId, service.id, fieldPaths);
  return null;
}

router.get("/services", async (req, res): Promise<void> => {
  const userId = await requireUserId(req, res);
  if (!userId) return;
  const services = await db
    .select()
    .from(apiServicesTable)
    .where(eq(apiServicesTable.ownerId, userId))
    .orderBy(desc(apiServicesTable.createdAt));
  const requestId = typeof req.id === "string" ? req.id : crypto.randomUUID();
  const response = (
    await Promise.all(
      services.map((service) => toSafeListServiceResponse(service, requestId)),
    )
  ).filter((service): service is NonNullable<typeof service> => service !== null);
  res.json(response);
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

  let targetConfiguration;
  try {
    targetConfiguration = normalizeTargetConfiguration(parsed.data);
  } catch (error) {
    const result = targetConfigError(error);
    res.status(result.status).json({ error: result.error, code: result.code });
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

  try {
    const response = await runServiceCreationTransaction(
      (callback) => db.transaction(callback),
      async (tx) => {
      const [service] = await tx
        .insert(apiServicesTable)
        .values({
          id: crypto.randomUUID(),
          ownerId: userId,
          name: normalizedName,
          url: parsed.data.url,
          expectedStructure: normalizedStructure,
          maxResponseTime: parsed.data.maxResponseTime,
           requestMethod: targetConfiguration.requestMethod,
           targetAuthType: targetConfiguration.targetAuthType,
           targetAuthHeaderName: targetConfiguration.targetAuthHeaderName,
           targetAuthSecretCiphertext: targetConfiguration.targetAuthSecretCiphertext,
           requestBody: targetConfiguration.requestBody,
          visibility: "PRIVATE",
        })
        .returning();

      if (!service) {
        throw new Error("Service insert returned no row");
      }

      return CreateServiceResponse.parse(await toServiceResponse(service, tx));
      },
    );
    res.status(201).json(response);
  } catch (error) {
    const conflict = getServiceCreationErrorResponse(error);
    if (conflict) {
      res.status(conflict.status).json(conflict.body);
      return;
    }
    throw error;
  }
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

  const existing = await findOwnedService(params.data.id, userId);
  if (!existing) {
    res.status(404).json({ error: "Dienst nicht gefunden.", code: "NOT_FOUND" });
    return;
  }

  let targetConfiguration;
  try {
    targetConfiguration = normalizeTargetConfiguration(body.data, existing);
  } catch (error) {
    const result = targetConfigError(error);
    res.status(result.status).json({ error: result.error, code: result.code });
    return;
  }

  const changes = {
    ...(body.data.name !== undefined ? { name: body.data.name.trim() } : {}),
    ...(body.data.expectedStructure !== undefined
      ? { expectedStructure: body.data.expectedStructure.trim() }
      : {}),
    ...(body.data.url !== undefined ? { url: body.data.url } : {}),
    ...(body.data.maxResponseTime !== undefined
      ? { maxResponseTime: body.data.maxResponseTime }
      : {}),
    ...(body.data.visibility !== undefined ? { visibility: body.data.visibility } : {}),
    requestMethod: targetConfiguration.requestMethod,
    targetAuthType: targetConfiguration.targetAuthType,
    targetAuthHeaderName: targetConfiguration.targetAuthHeaderName,
    targetAuthSecretCiphertext: targetConfiguration.targetAuthSecretCiphertext,
    requestBody: targetConfiguration.requestBody,
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
  if (!service) return;
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
    getTargetRequestOptions(service),
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