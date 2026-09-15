import { Router, type IRouter, type Request, type Response } from "express";
import { authenticateApiKey } from "../lib/api-key-auth";
import {
  buildExecutionPlan,
  executeAgentPlan,
  type ExecutionResponse,
  type ExecutionPlanResponse,
} from "../lib/agent-execution";
import { createAgentFeedback } from "../lib/agent-feedback";

const router: IRouter = Router();

function requestId(req: Request) {
  return String((req as Request & { id?: string }).id ?? "unknown");
}

function invalidRequest(res: Response, message: string) {
  res.status(400).json({
    error: message,
    code: "INVALID_REQUEST",
    feedback: createAgentFeedback({
      status: "INVALID_REQUEST",
      code: "INVALID_REQUEST",
      summary: message,
      nextAction: "Eine natürliche Aufgabe oder einen owner-gebundenen Service mit registrierter Operation und gültigen Parametern senden.",
      requiredAuth: true,
      actionContext: "READ",
    }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parsePlanBody(body: unknown) {
  if (!isRecord(body)) return null;
  const task = typeof body.task === "string" ? body.task.trim() : undefined;
  const serviceId = typeof body.serviceId === "string" ? body.serviceId.trim() : undefined;
  const operation = isRecord(body.operation)
    ? {
        method: typeof body.operation.method === "string" ? body.operation.method.trim().toUpperCase() : undefined,
        path: typeof body.operation.path === "string" ? body.operation.path.trim() : undefined,
      }
    : undefined;
  const parameters = body.parameters === undefined ? undefined : body.parameters;
  if (
    (!task && !serviceId) ||
    (task !== undefined && task.length === 0) ||
    (task !== undefined && task.length > 500) ||
    (serviceId !== undefined &&
      !/^(?:[A-Za-z0-9_-]{8,200}|external:[A-Za-z0-9_-]{1,180})$/.test(serviceId)) ||
    (parameters !== undefined && !isRecord(parameters)) ||
    (operation?.method && !["GET", "HEAD"].includes(operation.method)) ||
    (operation?.path && (!operation.path.startsWith("/") || operation.path.length > 2_048))
  ) {
    return null;
  }
  return { task, serviceId, operation, parameters: parameters as Record<string, unknown> | undefined };
}

function parseExecuteBody(body: unknown) {
  if (!isRecord(body) || typeof body.planId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.planId)) {
    return null;
  }
  if (body.parameters !== undefined && !isRecord(body.parameters)) return null;
  return {
    planId: body.planId,
    parameters: body.parameters as Record<string, unknown> | undefined,
  };
}

function httpStatusForExecution(response: ExecutionResponse) {
  if (response.status === "READY") return 200;
  if (response.status === "AUTH_REQUIRED") return 401;
  if (response.status === "RATE_LIMITED" || response.status === "PAYMENT_REQUIRED") return 429;
  if (response.code === "EXECUTION_PLAN_NOT_FOUND") return 404;
  if (response.status === "PROVIDER_ERROR") return 502;
  return 409;
}

router.post("/developer/execution/plan", async (req, res): Promise<void> => {
  const auth = await authenticateApiKey(req, res, "read");
  if (!auth) return;
  const input = parsePlanBody(req.body);
  if (!input) {
    invalidRequest(res, "Der PLAN-Request ist ungültig oder enthält keine natürliche Aufgabe bzw. Service-ID.");
    return;
  }
  const plan = await buildExecutionPlan(auth.ownerId, auth.keyId, input);
  res.status(200).json(plan);
});

router.post("/developer/execution/execute", async (req, res): Promise<void> => {
  const auth = await authenticateApiKey(req, res, "check");
  if (!auth) return;
  const input = parseExecuteBody(req.body);
  if (!input) {
    invalidRequest(res, "Der EXECUTE-Request benötigt eine gültige planId und die unveränderten Plan-Parameter.");
    return;
  }
  const response = await executeAgentPlan(
    auth.ownerId,
    auth.keyId,
    requestId(req),
    input.planId,
    input.parameters,
  );
  res.status(httpStatusForExecution(response)).json(response);
});

export default router;