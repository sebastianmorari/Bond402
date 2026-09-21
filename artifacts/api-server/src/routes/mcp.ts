import { and, desc, eq, or } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  apiServicesTable,
  db,
  executionAuditTable,
  executionPlansTable,
} from "@workspace/db";
import { buildPublicAgentDecision } from "../lib/agent-decision-public";
import {
  authenticateApiKeyQuiet,
  consumeMcpCredentialRateLimit,
  consumePublicRateLimit,
  type ApiKeyAuth,
  type ApiKeyAuthFailure,
  type ApiKeyScope,
} from "../lib/api-key-auth";
import { findOAuthAccessToken, type OAuthMcpAuth } from "../lib/oauth";
import { publicBaseUrl } from "../lib/public-sitemap";
import {
  buildExecutionPlan,
  executeAgentPlan,
  type ExecutionInput,
  type ExecutionPlanResponse,
  type ExecutionResponse,
} from "../lib/agent-execution";
import {
  calculateTrust,
  findOwnedService,
  loadChecks,
  toCheckResponse,
} from "../lib/service-data";
import { normalizeResponseMode } from "../lib/api-verifier";

const router: IRouter = Router();

export const MCP_PROTOCOL_VERSIONS = [
  "2026-07-28",
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
] as const;
const MCP_LEGACY_PROTOCOL_VERSIONS = new Set<string>([
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
]);
const MCP_MAX_TASK_LENGTH = 500;
const MCP_MAX_ARGUMENT_BYTES = 8 * 1024;
const MCP_MAX_RESULT_BYTES = 24 * 1024;
const MCP_SERVER_NAME = "Bond402";
const MCP_SERVER_VERSION = "0.1.0";

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

type ScopeTool = {
  name: string;
  title: string;
  description: string;
  scope: ApiKeyScope | null;
  readOnly: boolean;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, boolean>;
};
type McpAuth = ApiKeyAuth | OAuthMcpAuth;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isSafeInteger(value));
}

function requestId(req: Request) {
  return String((req as Request & { id?: string }).id ?? "unknown");
}

function byteLength(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function jsonRpcResponse(id: JsonRpcId | undefined, result: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, result };
}

function jsonRpcError(
  id: JsonRpcId | undefined,
  code: number,
  message: string,
  data: Record<string, unknown> = {},
) {
  return {
    jsonrpc: "2.0" as const,
    id: id ?? null,
    error: { code, message, data },
  };
}

function sendJsonRpcError(
  res: Response,
  id: JsonRpcId | undefined,
  status: number,
  code: number,
  message: string,
  data: Record<string, unknown> = {},
) {
  res.status(status).type("application/json").json(jsonRpcError(id, code, message, data));
}

function textResult(data: unknown, isError = false) {
  const serialized = JSON.stringify(data);
  const text = Buffer.byteLength(serialized, "utf8") <= MCP_MAX_RESULT_BYTES
    ? serialized
    : JSON.stringify({
        status: "BLOCKED",
        code: "MCP_RESULT_TOO_LARGE",
        summary: "Das Ergebnis überschreitet das MCP-Ausgabelimit.",
        nextAction: "Die Anfrage mit kleineren Parametern oder einer engeren Aufgabe wiederholen.",
      });
  return {
    resultType: "complete",
    content: [{ type: "text", text }],
    structuredContent: data,
    ...(isError ? { isError: true } : { isError: false }),
  };
}

function toolError(code: string, summary: string, nextAction: string) {
  return {
    status: "BLOCKED",
    code,
    summary,
    nextAction,
  };
}

function parseProtocolRequest(body: unknown): JsonRpcRequest | null {
  if (!isRecord(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string") return null;
  if (!hasOnlyKeys(body, ["jsonrpc", "id", "method", "params"])) return null;
  if ("id" in body && !isJsonRpcId(body.id)) return null;
  if ("params" in body && body.params !== undefined && !isRecord(body.params)) return null;
  if (body.method.length === 0 || body.method.length > 120) return null;
  return body as JsonRpcRequest;
}

function validateOrigin(req: Request) {
  const origin = req.get("origin");
  if (!origin || origin === "null") return true;
  try {
    const parsed = new URL(origin);
    const requestOrigin = `${req.protocol}://${req.get("host")}`.toLowerCase();
    const normalized = parsed.origin.toLowerCase();
    return normalized === requestOrigin ||
      normalized === "https://chatgpt.com" ||
      normalized === "https://chat.openai.com";
  } catch {
    return false;
  }
}

function protocolVersion(req: Request, body: JsonRpcRequest) {
  const header = req.get("mcp-protocol-version")?.trim() || null;
  if (header && !MCP_PROTOCOL_VERSIONS.includes(header as (typeof MCP_PROTOCOL_VERSIONS)[number])) {
    return { error: "UNSUPPORTED_PROTOCOL_VERSION", requested: header };
  }
  const version = header ?? "2025-03-26";
  if (header && body.params && isRecord(body.params._meta)) {
    const metadataVersion = body.params._meta["io.modelcontextprotocol/protocolVersion"];
    if (metadataVersion !== undefined && metadataVersion !== header) {
      return { error: "HEADER_MISMATCH", requested: header };
    }
  }
  return { version };
}

function validateTransportHeaders(req: Request, body: JsonRpcRequest) {
  const contentType = req.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return "CONTENT_TYPE_REQUIRED";
  const accept = req.get("accept") ?? "";
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    return "ACCEPT_HEADER_REQUIRED";
  }
  if (byteLength(body) > MCP_MAX_ARGUMENT_BYTES) return "MCP_REQUEST_TOO_LARGE";
  return null;
}

function validateLegacyInitialize(params: Record<string, unknown> | undefined) {
  if (!params || !hasOnlyKeys(params, ["protocolVersion", "capabilities", "clientInfo"])) return false;
  if (
    typeof params.protocolVersion !== "string" ||
    !MCP_LEGACY_PROTOCOL_VERSIONS.has(params.protocolVersion) ||
    !isRecord(params.capabilities) ||
    !isRecord(params.clientInfo) ||
    typeof params.clientInfo.name !== "string" ||
    typeof params.clientInfo.version !== "string" ||
    params.clientInfo.name.length > 120 ||
    params.clientInfo.version.length > 80
  ) return false;
  return true;
}

function publicTools(): ScopeTool[] {
  return [
    {
      name: "search_services",
      title: "Search Bond402 services",
      description: "READ-ONLY. Search public Bond402 service and capability metadata for a natural-language task. External discovery remains unverified and is never executable.",
      scope: null,
      readOnly: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          task: { type: "string", minLength: 1, maxLength: MCP_MAX_TASK_LENGTH },
        },
        required: ["task"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    {
      name: "compare_or_decide",
      title: "Compare Bond402 candidates",
      description: "READ-ONLY. Return the deterministic Bond402 decision contract for a natural-language task, including candidates, blockers, required parameters, verification and next action.",
      scope: null,
      readOnly: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          task: { type: "string", minLength: 1, maxLength: MCP_MAX_TASK_LENGTH },
        },
        required: ["task"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
  ];
}

function privateTools(scopes: readonly ApiKeyScope[]): ScopeTool[] {
  const all: ScopeTool[] = [
    {
      name: "get_service_details",
      title: "Get owned service details",
      description: "READ-ONLY. Read trust, verification and recent checks for a service owned by the authenticated Bond402 principal.",
      scope: "read",
      readOnly: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { serviceId: { type: "string", minLength: 8, maxLength: 200 } },
        required: ["serviceId"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    {
      name: "plan_execution",
      title: "Create a Bond402 execution plan",
      description: "PLAN-ONLY. Convert a natural task or owned service into a READY plan. No provider request is made; only registered GET/HEAD operations are eligible.",
      scope: "plan",
      readOnly: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          task: { type: "string", minLength: 1, maxLength: MCP_MAX_TASK_LENGTH },
          serviceId: { type: "string", minLength: 8, maxLength: 200 },
          operation: {
            type: "object",
            additionalProperties: false,
            properties: {
              method: { type: "string", enum: ["GET", "HEAD"] },
              path: { type: "string", minLength: 1, maxLength: 2048 },
            },
          },
          parameters: { type: "object", maxProperties: 32 },
        },
        anyOf: [{ required: ["task"] }, { required: ["serviceId"] }],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    {
      name: "execute_plan",
      title: "Execute a READY Bond402 plan",
      description: "EXECUTING. Execute only an unexpired, owner-bound, single-use READY plan with unchanged parameters. Quota, verification, SSRF and provider safety checks remain enforced.",
      scope: "execute",
      readOnly: false,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          planId: { type: "string", pattern: "^[0-9a-f-]{36}$" },
          parameters: { type: "object", maxProperties: 32 },
        },
        required: ["planId"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    {
      name: "get_execution_status",
      title: "Get execution and audit status",
      description: "READ-ONLY AUDIT. Read owner-bound plan and execution audit metadata. Provider payloads and secrets are never stored or returned by this tool.",
      scope: "audit",
      readOnly: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          planId: { type: "string", pattern: "^[0-9a-f-]{36}$" },
          requestId: { type: "string", minLength: 1, maxLength: 120 },
        },
        anyOf: [{ required: ["planId"] }, { required: ["requestId"] }],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
  ];
  return all.filter((tool) => tool.scope && scopes.includes(tool.scope));
}

function visibleTools(auth: McpAuth | null) {
  return [...publicTools(), ...privateTools(auth?.scopes ?? [])]
    .sort((left, right) => left.name.localeCompare(right.name));
}

function parseTaskArgs(args: unknown) {
  if (!isRecord(args) || !hasOnlyKeys(args, ["task"]) || typeof args.task !== "string") return null;
  const task = args.task.trim();
  return task.length > 0 && task.length <= MCP_MAX_TASK_LENGTH ? { task } : null;
}

function parseServiceDetailsArgs(args: unknown) {
  if (!isRecord(args) || !hasOnlyKeys(args, ["serviceId"]) || typeof args.serviceId !== "string") return null;
  return /^[A-Za-z0-9_-]{8,200}$/.test(args.serviceId) ? { serviceId: args.serviceId } : null;
}

function parsePlanArgs(args: unknown): ExecutionInput | null {
  if (!isRecord(args) || !hasOnlyKeys(args, ["task", "serviceId", "operation", "parameters"])) return null;
  const task = args.task === undefined ? undefined : typeof args.task === "string" ? args.task.trim() : null;
  const serviceId = args.serviceId === undefined
    ? undefined
    : typeof args.serviceId === "string" && /^(?:[A-Za-z0-9_-]{8,200}|external:[A-Za-z0-9_-]{1,180})$/.test(args.serviceId)
      ? args.serviceId
      : null;
  if (task === null || serviceId === null || (!task && !serviceId) || (task && task.length > MCP_MAX_TASK_LENGTH)) return null;
  let operation: ExecutionInput["operation"];
  if (args.operation !== undefined) {
    if (!isRecord(args.operation) || !hasOnlyKeys(args.operation, ["method", "path"])) return null;
    const method = typeof args.operation.method === "string" ? args.operation.method.toUpperCase() : undefined;
    const path = typeof args.operation.path === "string" ? args.operation.path : undefined;
    if ((method && !["GET", "HEAD"].includes(method)) || (path && (!path.startsWith("/") || path.length > 2048))) return null;
    operation = { method, path };
  }
  if (args.parameters !== undefined && (!isRecord(args.parameters) || Object.keys(args.parameters).length > 32)) return null;
  if (args.parameters !== undefined && byteLength(args.parameters) > MCP_MAX_ARGUMENT_BYTES) return null;
  return {
    task: task || undefined,
    serviceId: serviceId || undefined,
    operation,
    parameters: args.parameters as Record<string, unknown> | undefined,
  };
}

function parseExecuteArgs(args: unknown) {
  if (!isRecord(args) || !hasOnlyKeys(args, ["planId", "parameters"]) || typeof args.planId !== "string" || !/^[0-9a-f-]{36}$/i.test(args.planId)) return null;
  if (args.parameters !== undefined && (!isRecord(args.parameters) || Object.keys(args.parameters).length > 32 || byteLength(args.parameters) > MCP_MAX_ARGUMENT_BYTES)) return null;
  return { planId: args.planId, parameters: args.parameters as Record<string, unknown> | undefined };
}

function parseAuditArgs(args: unknown) {
  if (!isRecord(args) || !hasOnlyKeys(args, ["planId", "requestId"])) return null;
  const planId = typeof args.planId === "string" && /^[0-9a-f-]{36}$/i.test(args.planId) ? args.planId : undefined;
  const requestIdValue = typeof args.requestId === "string" && /^[A-Za-z0-9._:-]{1,120}$/.test(args.requestId) ? args.requestId : undefined;
  return planId || requestIdValue ? { planId, requestId: requestIdValue } : null;
}

function safeExecutionResponse(response: ExecutionResponse) {
  const data = response.data;
  const boundedData = data !== null && byteLength(data) > MCP_MAX_RESULT_BYTES / 2
    ? "[OUTPUT_TRUNCATED]"
    : data;
  return { ...response, data: boundedData };
}

function safePlanResponse(response: ExecutionPlanResponse) {
  return {
    ...response,
    candidate: response.candidate
      ? {
          ...response.candidate,
          knownFacts: response.candidate.knownFacts.slice(0, 32),
          safeOperations: response.candidate.safeOperations.slice(0, 16),
        }
      : null,
    decision: {
      ...response.decision,
      candidates: response.decision.candidates.slice(0, 20).map((candidate) => ({
        ...candidate,
        knownFacts: candidate.knownFacts.slice(0, 32),
        safeOperations: candidate.safeOperations.slice(0, 16),
      })),
    },
  };
}

function logMcpCall(
  req: Request,
  tool: string,
  scope: ApiKeyScope | "public",
  auth: McpAuth | null,
  status: string,
  startedAt: number,
  details: { serviceId?: string | null; planId?: string | null } = {},
) {
  req.log.info({
    requestId: requestId(req),
    mcpTool: tool,
    mcpScope: scope,
    principal: auth?.credentialType === "oauth" ? "owner_oauth" : auth ? "owner_api_key" : "anonymous",
    ownerId: auth?.ownerId ?? null,
    serviceId: details.serviceId ?? null,
    planId: details.planId ?? null,
    status,
    durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
  }, "MCP tool call");
}

function mcpResourceMetadataUrl(req: Request) {
  return new URL("/.well-known/oauth-protected-resource", `${publicBaseUrl(req).replace(/\/+$/, "")}/`).toString();
}

function mcpResourceUrl(req: Request) {
  return new URL("/mcp", `${publicBaseUrl(req).replace(/\/+$/, "")}/`).toString();
}

async function authenticateMcpCredentialQuiet(
  req: Request,
  scope: "read" | "check",
): Promise<{ auth: McpAuth } | { failure: ApiKeyAuthFailure }> {
  const authorization = req.get("authorization") ?? "";
  const oauthMatch = authorization.match(/^Bearer\s+(b402_oauth_[A-Za-z0-9_-]{20,})$/);
  if (oauthMatch) {
    const oauth = await findOAuthAccessToken(oauthMatch[1], mcpResourceUrl(req));
    if (!oauth) {
      return { failure: { status: 401, code: "INVALID_OAUTH_TOKEN", retryAfterSeconds: null } };
    }
    const rate = await consumeMcpCredentialRateLimit(oauth.keyId, oauth.ownerId, scope);
    if (!rate.allowed) {
      return { failure: { status: 429, code: "RATE_LIMITED", retryAfterSeconds: rate.retryAfter } };
    }
    return { auth: oauth };
  }
  return authenticateApiKeyQuiet(req, scope);
}

async function optionalAuth(req: Request): Promise<McpAuth | null> {
  if (!req.get("authorization")) return null;
  const result = await authenticateMcpCredentialQuiet(req, "read");
  return "auth" in result ? result.auth : null;
}

async function requireScope(
  req: Request,
  res: Response,
  scope: ApiKeyScope,
) {
  const rateScope = scope === "execute" ? "check" : "read";
  const result = await authenticateMcpCredentialQuiet(req, rateScope);
  if ("failure" in result) {
    if (result.failure.retryAfterSeconds !== null) res.set("Retry-After", String(result.failure.retryAfterSeconds));
    if (result.failure.status === 401) {
      res.set(
        "WWW-Authenticate",
        `Bearer realm="Bond402 MCP", resource_metadata="${mcpResourceMetadataUrl(req)}"`,
      );
    }
    res.status(result.failure.status).type("application/json").json({
      error: result.failure.code === "RATE_LIMITED"
        ? "MCP-Anfragen sind rate-limited."
        : "Ein gültiger Bond402-Zugang ist erforderlich.",
      code: result.failure.code,
      requestId: requestId(req),
    });
    return null;
  }
  if (!result.auth.scopes.includes(scope)) {
    if (result.auth.credentialType === "oauth") {
      res.set(
        "WWW-Authenticate",
        `Bearer error="insufficient_scope", scope="${scope}", resource_metadata="${mcpResourceMetadataUrl(req)}"`,
      );
    }
    res.status(403).type("application/json").json({
      error: "Der Developer-Key besitzt den erforderlichen MCP-Scope nicht.",
      code: "SCOPE_REQUIRED",
      requiredScope: scope,
      requestId: requestId(req),
    });
    return null;
  }
  return result.auth;
}

async function callTool(
  req: Request,
  res: Response,
  name: string,
  args: unknown,
  auth: McpAuth | null,
) {
  const startedAt = performance.now();
  const fail = (scope: ApiKeyScope | "public", code: string, summary: string, nextAction: string, status = "BLOCKED") => {
    logMcpCall(req, name, scope, auth, status, startedAt);
    return textResult({ requestId: requestId(req), ...toolError(code, summary, nextAction) }, true);
  };

  if (name === "search_services" || name === "compare_or_decide") {
    const parsed = parseTaskArgs(args);
    if (!parsed) return fail("public", "INVALID_ARGUMENTS", "Die natürliche Aufgabe ist ungültig oder zu groß.", "Eine Aufgabe mit 1 bis 500 Zeichen senden.", "INVALID_REQUEST");
    const publicRate = await consumePublicRateLimit(req.ip ?? "unknown", "mcp", 60);
    if (!publicRate.allowed) {
      res.set("Retry-After", String(publicRate.retryAfter));
      return fail("public", "RATE_LIMITED", "Das öffentliche MCP-Limit wurde erreicht.", "Retry-After beachten und später erneut versuchen.", "RATE_LIMITED");
    }
    const decision = await buildPublicAgentDecision(parsed.task);
    const data = name === "search_services"
      ? {
          requestId: requestId(req),
          intent: decision.intent,
          candidates: decision.candidates.slice(0, 20),
          nextAction: decision.nextAction,
          provenance: decision.provenance,
        }
      : { requestId: requestId(req), ...decision };
    logMcpCall(req, name, "public", auth, "READY", startedAt);
    return textResult(data);
  }

  if (name === "get_service_details") {
    const ownerAuth = auth?.scopes.includes("read") ? auth : await requireScope(req, res, "read");
    if (!ownerAuth) return null;
    const parsed = parseServiceDetailsArgs(args);
    if (!parsed) return fail("read", "INVALID_ARGUMENTS", "Die Service-ID ist ungültig.", "Eine owner-gebundene Service-ID senden.", "INVALID_REQUEST");
    const service = await findOwnedService(parsed.serviceId, ownerAuth.ownerId);
    if (!service) return fail("read", "NOT_FOUND", "Der Service gehört nicht zum authentifizierten Owner oder existiert nicht.", "Eine eigene registrierte Service-ID verwenden.", "NOT_FOUND");
    const checks = await loadChecks(service.id);
    const trust = calculateTrust(checks, service.maxResponseTime, service.expectedStructure);
    const data = {
      requestId: requestId(req),
      service: {
        id: service.id,
        name: service.name,
        url: service.url,
        requestMethod: service.requestMethod,
        responseMode: normalizeResponseMode(service.responseMode),
        maxResponseTime: service.maxResponseTime,
        securityStatus: service.securityStatus,
        authRequirement: service.authRequirement,
      },
      trustScore: trust.score,
      trustExplanation: trust.explanation,
      availabilityScore: trust.availabilityScore,
      securityConfidence: trust.securityConfidence,
      latestCheck: checks[0] ? toCheckResponse(checks[0]) : null,
      checks: checks.slice(0, 20).map(toCheckResponse),
      nextAction: "Nur die registrierte GET-/HEAD-Operation im bestehenden Bond402-Plan-Flow verwenden.",
    };
    logMcpCall(req, name, "read", ownerAuth, "READY", startedAt, { serviceId: service.id });
    return textResult(data);
  }

  if (name === "plan_execution") {
    const ownerAuth = auth?.scopes.includes("plan") ? auth : await requireScope(req, res, "plan");
    if (!ownerAuth) return null;
    const parsed = parsePlanArgs(args);
    if (!parsed) return fail("plan", "INVALID_ARGUMENTS", "Die Planargumente sind ungültig oder enthalten unbekannte Felder.", "Nur task/serviceId, registrierte GET-/HEAD-Operation und begrenzte Parameter senden.", "INVALID_REQUEST");
    const plan = safePlanResponse(await buildExecutionPlan(ownerAuth.ownerId, ownerAuth.keyId, parsed));
    logMcpCall(req, name, "plan", ownerAuth, plan.status, startedAt, { serviceId: plan.service.id, planId: plan.planId });
    return textResult({ requestId: requestId(req), ...plan }, plan.status !== "READY");
  }

  if (name === "execute_plan") {
    const ownerAuth = auth?.scopes.includes("execute") ? auth : await requireScope(req, res, "execute");
    if (!ownerAuth) return null;
    const parsed = parseExecuteArgs(args);
    if (!parsed) return fail("execute", "INVALID_ARGUMENTS", "Die Execute-Argumente sind ungültig.", "Eine gültige planId und unveränderte Plan-Parameter senden.", "INVALID_REQUEST");
    const execution = safeExecutionResponse(await executeAgentPlan(
      ownerAuth.ownerId,
      ownerAuth.keyId,
      requestId(req),
      parsed.planId,
      parsed.parameters,
    ));
    logMcpCall(req, name, "execute", ownerAuth, execution.status, startedAt, { serviceId: execution.service.id, planId: execution.planId });
    return textResult({ ...execution, requestId: requestId(req) }, execution.status !== "READY");
  }

  if (name === "get_execution_status") {
    const ownerAuth = auth?.scopes.includes("audit") ? auth : await requireScope(req, res, "audit");
    if (!ownerAuth) return null;
    const parsed = parseAuditArgs(args);
    if (!parsed) return fail("audit", "INVALID_ARGUMENTS", "planId oder requestId ist erforderlich.", "Eine gültige ownergebundene Plan- oder Request-ID senden.", "INVALID_REQUEST");
    const planCondition = parsed.planId ? eq(executionPlansTable.id, parsed.planId) : undefined;
    const auditCondition = parsed.planId
      ? eq(executionAuditTable.planId, parsed.planId)
      : eq(executionAuditTable.requestId, parsed.requestId!);
    const [plan] = await db
      .select()
      .from(executionPlansTable)
      .where(and(
        eq(executionPlansTable.ownerId, ownerAuth.ownerId),
        eq(executionPlansTable.apiKeyId, ownerAuth.keyId),
        ...(planCondition ? [planCondition] : []),
      ))
      .limit(1);
    const audits = await db
      .select()
      .from(executionAuditTable)
      .where(and(eq(executionAuditTable.ownerId, ownerAuth.ownerId), auditCondition))
      .orderBy(desc(executionAuditTable.startedAt))
      .limit(10);
    if (!plan && audits.length === 0) return fail("audit", "NOT_FOUND", "Kein owner-gebundener Plan oder Audit-Eintrag gefunden.", "Nur eigene Bond402-IDs verwenden.", "NOT_FOUND");
    const data = {
      requestId: requestId(req),
      plan: plan
        ? {
            id: plan.id,
            status: plan.status,
            serviceId: plan.serviceId,
            operation: { method: plan.method, path: plan.path },
            expiresAt: plan.expiresAt.toISOString(),
            consumedAt: plan.consumedAt?.toISOString() ?? null,
          }
        : null,
      audits: audits.map((audit) => ({
        requestId: audit.requestId,
        planId: audit.planId,
        serviceId: audit.serviceId,
        operation: { method: audit.operationMethod, path: audit.operationPath },
        startedAt: audit.startedAt.toISOString(),
        endedAt: audit.endedAt.toISOString(),
        durationMs: audit.durationMs,
        status: audit.status,
        code: audit.code,
        providerHttpStatus: audit.providerHttpStatus,
        retryable: audit.retryable === "true",
        retryAfterSeconds: audit.retryAfterSeconds,
        quotaUsed: audit.quotaUsed,
        outputAvailable: false,
      })),
      nextAction: "Providerpayload wird nicht im Audit gespeichert; für ein Ergebnis den direkten execute_plan-Response verwenden.",
    };
    logMcpCall(req, name, "audit", ownerAuth, "READY", startedAt, { planId: plan?.id ?? parsed.planId ?? null });
    return textResult(data);
  }

  return fail("public", "UNKNOWN_TOOL", "Dieses MCP-Tool ist nicht verfügbar.", "tools/list abrufen und nur dort aufgeführte Tools verwenden.", "NOT_FOUND");
}

router.post("/", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  if (!validateOrigin(req)) {
    res.status(403).type("application/json").json({ error: "Ungültiger MCP-Origin.", code: "INVALID_ORIGIN", requestId: requestId(req) });
    return;
  }
  const body = parseProtocolRequest(req.body);
  if (!body) {
    sendJsonRpcError(res, null, 400, -32600, "Invalid Request", { requestId: requestId(req) });
    return;
  }
  const headerError = validateTransportHeaders(req, body);
  if (headerError) {
    sendJsonRpcError(res, body.id, 400, -32600, "Invalid Request", { code: headerError, requestId: requestId(req) });
    return;
  }
  const version = protocolVersion(req, body);
  if ("error" in version) {
    sendJsonRpcError(res, body.id, 400, -32022, version.error ?? "Unsupported protocol request", {
      code: version.error ?? "UNSUPPORTED_PROTOCOL_VERSION",
      requested: version.requested,
      supported: MCP_PROTOCOL_VERSIONS,
      requestId: requestId(req),
    });
    return;
  }
  if (body.method === "notifications/initialized") {
    res.status(202).end();
    return;
  }
  if (body.method === "initialize") {
    if (version.version === MCP_CURRENT_PROTOCOL_VERSION || !validateLegacyInitialize(body.params)) {
      sendJsonRpcError(res, body.id, 400, -32602, "Initialize parameters are invalid for this protocol version.", { requestId: requestId(req) });
      return;
    }
    res.type("application/json").json(jsonRpcResponse(body.id, {
      protocolVersion: version.version,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
      instructions: "Use search_services or compare_or_decide first; then owner-scoped plan_execution and execute_plan only when the plan status is READY.",
    }));
    return;
  }
  if (body.method === "server/discover") {
    res.type("application/json").json(jsonRpcResponse(body.id, {
      protocolVersions: [...MCP_PROTOCOL_VERSIONS],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    }));
    return;
  }
  if (body.method === "tools/list") {
    if (body.params && !hasOnlyKeys(body.params, ["cursor", "_meta"])) {
      sendJsonRpcError(res, body.id, 400, -32602, "Unknown tools/list parameters.", { requestId: requestId(req) });
      return;
    }
    if (body.params?.cursor !== undefined && typeof body.params.cursor !== "string") {
      sendJsonRpcError(res, body.id, 400, -32602, "Invalid tools/list cursor.", { requestId: requestId(req) });
      return;
    }
    const auth = await optionalAuth(req);
    if (
      req.get("authorization")?.match(/^Bearer\s+b402_oauth_[A-Za-z0-9_-]{20,}$/) &&
      !auth
    ) {
      res.set("WWW-Authenticate", `Bearer error="invalid_token", resource_metadata="${mcpResourceMetadataUrl(req)}"`);
      res.status(401).type("application/json").json({
        error: "Der OAuth-Zugang ist ungültig oder abgelaufen.",
        code: "INVALID_OAUTH_TOKEN",
        requestId: requestId(req),
      });
      return;
    }
    const tools = visibleTools(auth);
    res.type("application/json").json(jsonRpcResponse(body.id, {
      resultType: "complete",
      tools,
      ttlMs: 300_000,
      cacheScope: auth ? "principal" : "public",
    }));
    return;
  }
  if (body.method === "tools/call") {
    if (!body.params || !hasOnlyKeys(body.params, ["name", "arguments", "_meta"]) || typeof body.params.name !== "string") {
      sendJsonRpcError(res, body.id, 400, -32602, "Invalid tools/call parameters.", { requestId: requestId(req) });
      return;
    }
    const tool = visibleTools(await optionalAuth(req)).find((candidate) => candidate.name === body.params!.name);
    if (!tool) {
      sendJsonRpcError(res, body.id, 404, -32601, "Method not found", { code: "UNKNOWN_TOOL", requestId: requestId(req) });
      return;
    }
    if (body.params.arguments !== undefined && !isRecord(body.params.arguments)) {
      sendJsonRpcError(res, body.id, 400, -32602, "Tool arguments must be an object.", { requestId: requestId(req) });
      return;
    }
    const auth = tool.scope ? await requireScope(req, res, tool.scope) : await optionalAuth(req);
    if (tool.scope && !auth) return;
    const result = await callTool(req, res, tool.name, body.params.arguments ?? {}, auth);
    if (result) res.type("application/json").json(jsonRpcResponse(body.id, result));
    return;
  }
  sendJsonRpcError(res, body.id, 404, -32601, "Method not found", { requestId: requestId(req) });
});

router.delete("/", (req, res) => {
  if (req.get("mcp-session-id")) {
    res.status(405).type("application/json").json({ error: "Bond402 uses stateless MCP sessions.", code: "METHOD_NOT_ALLOWED" });
    return;
  }
  res.status(405).end();
});

router.get("/", (req, res) => {
  res.set("Allow", "POST");
  res.status(405).type("application/json").json({
    error: "Bond402 MCP verwendet Streamable HTTP POST statt GET-SSE.",
    code: "METHOD_NOT_ALLOWED",
    requestId: requestId(req),
  });
});

export default router;