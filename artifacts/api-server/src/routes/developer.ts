import { Router, type IRouter, type Request, type Response } from "express";
import {
  DeveloperGetLatestCheckParams,
  DeveloperGetLatestCheckResponse,
  DeveloperGetServiceParams,
  DeveloperGetServiceResponse,
  DeveloperRunServiceCheckParams,
  DeveloperRunServiceCheckResponse,
  DeveloperPreActionCheckResponse,
} from "@workspace/api-zod";
import { authenticateApiKey } from "../lib/api-key-auth";
import { normalizeResponseMode, runLiveVerification } from "../lib/api-verifier";
import {
  calculateTrust,
  findOwnedService,
  getTargetRequestOptions,
  loadChecks,
  saveOutcome,
  toCheckResponse,
} from "../lib/service-data";
import { requireCheckQuota } from "../lib/quota";
import { evaluatePreAction, type ActionContext } from "../lib/pre-action";
import { createAgentFeedback, feedbackForDecision, feedbackForHttpError } from "../lib/agent-feedback";

const router: IRouter = Router();

async function buildResponse(service: NonNullable<Awaited<ReturnType<typeof findOwnedService>>>) {
  const checks = await loadChecks(service.id);
  const trust = calculateTrust(checks, service.maxResponseTime, service.expectedStructure);
  return {
    service: {
      id: service.id,
      name: service.name,
      url: service.url,
      expectedStructure: service.expectedStructure,
       responseMode: normalizeResponseMode(service.responseMode),
      maxResponseTime: service.maxResponseTime,
    },
    trustScore: trust.score,
    trustExplanation: trust.explanation,
    availabilityScore: trust.availabilityScore,
    securityConfidence: trust.securityConfidence,
    latestCheck: checks[0] ? toCheckResponse(checks[0]) : null,
      checks: checks.map(toCheckResponse),
  };
}

async function authenticateAndFind(
  req: Request,
  res: Response,
  scope: "read" | "check",
  id: string,
) {
  const auth = await authenticateApiKey(req, res, scope);
  if (!auth) return null;
  const service = await findOwnedService(id, auth.ownerId);
  if (!service) {
    res.status(404).json({
      error: "Dienst nicht gefunden.",
      code: "NOT_FOUND",
      feedback: feedbackForHttpError(404, "NOT_FOUND", "Dienst nicht gefunden.", { serviceId: id }),
    });
    return null;
  }
  return { service, ownerId: auth.ownerId };
}

router.get("/developer/services/:id", async (req, res): Promise<void> => {
  const params = DeveloperGetServiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({
      error: "Ungültige Dienst-ID.",
      code: "INVALID_ID",
      feedback: feedbackForHttpError(400, "INVALID_ID", "Ungültige Dienst-ID."),
    });
    return;
  }
  const found = await authenticateAndFind(req, res, "read", params.data.id);
  if (!found) return;
  const response = DeveloperGetServiceResponse.parse(await buildResponse(found.service));
  res.json({
    ...response,
    feedback: createAgentFeedback({
      status: "READY",
      code: "DEVELOPER_SERVICE_READY",
      summary: "Der owner-gebundene Developer-Service wurde gefunden.",
      nextAction: "Gespeicherte Signale lesen oder mit gültigem Check-Kontext eine Prüfung anfordern.",
      serviceId: found.service.id,
      serviceName: found.service.name,
      provider: new URL(found.service.url).hostname,
      source: "BOND402_OWNER_CATALOG",
      verification: found.service.securityStatus,
      requiredAuth: true,
    }),
  });
});

router.post("/developer/services/:id/checks", async (req, res): Promise<void> => {
  const params = DeveloperRunServiceCheckParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({
      error: "Ungültige Dienst-ID.",
      code: "INVALID_ID",
      feedback: feedbackForHttpError(400, "INVALID_ID", "Ungültige Dienst-ID."),
    });
    return;
  }
  const found = await authenticateAndFind(req, res, "check", params.data.id);
  if (!found) return;
  if (!(await requireCheckQuota(found.ownerId, res))) return;
  const service = found.service;
  const outcome = await runLiveVerification(
    service.url,
    service.expectedStructure,
    service.maxResponseTime,
    getTargetRequestOptions(service),
    normalizeResponseMode(service.responseMode),
  );
  await saveOutcome(service.id, "LIVE", outcome);
  const response = DeveloperRunServiceCheckResponse.parse(await buildResponse(service));
  res.status(201).json({
    ...response,
    feedback: createAgentFeedback({
      status: "READY",
      code: "LIVE_CHECK_COMPLETED",
      summary: "Der owner-gebundene Live-Check wurde abgeschlossen.",
      nextAction: "Die neue Beobachtung zusammen mit Trust-, Verfügbarkeits- und Security-Signalen bewerten.",
      serviceId: service.id,
      serviceName: service.name,
      provider: new URL(service.url).hostname,
      source: "BOND402_OWNER_CATALOG",
      verification: "BOND402_OBSERVED",
      requiredAuth: true,
    }),
  });
});

router.get("/developer/services/:id/checks/latest", async (req, res): Promise<void> => {
  const params = DeveloperGetLatestCheckParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({
      error: "Ungültige Dienst-ID.",
      code: "INVALID_ID",
      feedback: feedbackForHttpError(400, "INVALID_ID", "Ungültige Dienst-ID."),
    });
    return;
  }
  const found = await authenticateAndFind(req, res, "read", params.data.id);
  if (!found) return;
  const response = await buildResponse(found.service);
  if (!response.latestCheck) {
    res.status(404).json({
      error: "Für diesen Dienst liegt noch keine Prüfung vor.",
      code: "NO_CHECK_FOUND",
      feedback: feedbackForHttpError(
        404,
        "NO_CHECK_FOUND",
        "Für diesen Dienst liegt noch keine Prüfung vor.",
        { serviceId: found.service.id, serviceName: found.service.name },
      ),
    });
    return;
  }
  res.json(DeveloperGetLatestCheckResponse.parse(response));
});

router.post("/developer/services/:id/pre-action-check", async (req, res): Promise<void> => {
  const params = DeveloperGetServiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({
      error: "Ungültige Dienst-ID.",
      code: "INVALID_ID",
      feedback: feedbackForHttpError(400, "INVALID_ID", "Ungültige Dienst-ID."),
    });
    return;
  }
  const found = await authenticateAndFind(req, res, "check", params.data.id);
  if (!found) return;
  if (!(await requireCheckQuota(found.ownerId, res))) return;
  const checks = await loadChecks(found.service.id);
  const requestedContext = req.body?.actionContext ?? "GENERAL";
  const validContexts = ["GENERAL", "READ", "WRITE", "PAYMENT", "CREDENTIAL_USE"] as const;
  if (
    typeof requestedContext !== "string" ||
    !validContexts.includes(requestedContext as (typeof validContexts)[number])
  ) {
    res.status(400).json({
      error: "Ungültiger actionContext.",
      code: "INVALID_ACTION_CONTEXT",
      feedback: feedbackForHttpError(400, "INVALID_ACTION_CONTEXT", "Ungültiger actionContext.", {
        serviceId: found.service.id,
        serviceName: found.service.name,
        provider: new URL(found.service.url).hostname,
        source: "BOND402_OWNER_CATALOG",
        verification: found.service.securityStatus,
      }),
    });
    return;
  }
  const evaluated = evaluatePreAction(found.service, checks, requestedContext as ActionContext);
  const response = DeveloperPreActionCheckResponse.parse({
      serviceId: found.service.id,
      serviceName: found.service.name,
       ...evaluated,
      access: { requiresDeveloperKey: true, liveCheckRequiresDeveloperKey: true },
      usage: { countsAgainstMonthlyPlan: true, rateLimit: "developer key and monthly quota" },
     });
  res.json({
    ...response,
    feedback: feedbackForDecision(evaluated.decision, {
      serviceId: found.service.id,
      serviceName: found.service.name,
      provider: new URL(found.service.url).hostname,
      source: "BOND402_OWNER_CATALOG",
      verification: found.service.securityStatus,
      requiredAuth: true,
      actionContext: evaluated.actionContext,
    }),
  });
});

export default router;