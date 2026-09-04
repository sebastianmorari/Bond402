import { Router, type IRouter, type Request, type Response } from "express";
import {
  DeveloperGetLatestCheckParams,
  DeveloperGetLatestCheckResponse,
  DeveloperGetServiceParams,
  DeveloperGetServiceResponse,
  DeveloperRunServiceCheckParams,
  DeveloperRunServiceCheckResponse,
} from "@workspace/api-zod";
import { authenticateApiKey } from "../lib/api-key-auth";
import { runLiveVerification } from "../lib/api-verifier";
import {
  calculateTrust,
  findOwnedService,
  loadChecks,
  saveOutcome,
  toCheckResponse,
} from "../lib/service-data";

const router: IRouter = Router();

async function buildResponse(service: NonNullable<Awaited<ReturnType<typeof findOwnedService>>>) {
  const checks = await loadChecks(service.id);
  const trust = calculateTrust(checks, service.maxResponseTime);
  return {
    service: {
      id: service.id,
      name: service.name,
      url: service.url,
      expectedStructure: service.expectedStructure,
      maxResponseTime: service.maxResponseTime,
    },
    trustScore: trust.score,
    trustExplanation: trust.explanation,
    latestCheck: checks[0] ? toCheckResponse(checks[0]) : null,
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
    res.status(404).json({ error: "Dienst nicht gefunden.", code: "NOT_FOUND" });
    return null;
  }
  return service;
}

router.get("/developer/services/:id", async (req, res): Promise<void> => {
  const params = DeveloperGetServiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Ungültige Dienst-ID.", code: "INVALID_ID" });
    return;
  }
  const service = await authenticateAndFind(req, res, "read", params.data.id);
  if (!service) return;
  res.json(DeveloperGetServiceResponse.parse(await buildResponse(service)));
});

router.post("/developer/services/:id/checks", async (req, res): Promise<void> => {
  const params = DeveloperRunServiceCheckParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Ungültige Dienst-ID.", code: "INVALID_ID" });
    return;
  }
  const service = await authenticateAndFind(req, res, "check", params.data.id);
  if (!service) return;
  const outcome = await runLiveVerification(
    service.url,
    service.expectedStructure,
    service.maxResponseTime,
  );
  await saveOutcome(service.id, "LIVE", outcome);
  res.status(201).json(DeveloperRunServiceCheckResponse.parse(await buildResponse(service)));
});

router.get("/developer/services/:id/checks/latest", async (req, res): Promise<void> => {
  const params = DeveloperGetLatestCheckParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Ungültige Dienst-ID.", code: "INVALID_ID" });
    return;
  }
  const service = await authenticateAndFind(req, res, "read", params.data.id);
  if (!service) return;
  const response = await buildResponse(service);
  if (!response.latestCheck) {
    res.status(404).json({ error: "Für diesen Dienst liegt noch keine Prüfung vor.", code: "NO_CHECK_FOUND" });
    return;
  }
  res.json(DeveloperGetLatestCheckResponse.parse(response));
});

export default router;