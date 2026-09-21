import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  apiServicesTable,
  db,
  executionAuditTable,
  executionPlansTable,
  type ApiServiceRow,
  type ExecutionPlanRow,
} from "@workspace/db";
import {
  decideAgentTask,
  normalizeAgentTask,
  type AgentCandidateInput,
  type AgentDecisionCandidate,
} from "./agent-decision";
import { decryptTargetSecret } from "./target-auth";
import { safeGet, validatePublicUrl } from "./api-verifier";
import {
  findOwnedService,
  getTargetRequestOptions,
  loadChecks,
} from "./service-data";
import { getRegisteredExecutionOperations } from "./execution-metadata";
import { evaluatePreAction } from "./pre-action";
import { consumeMonthlyCheck, toUsageResponse } from "./usage";
import { createAgentFeedback, type AgentFeedbackStatus } from "./agent-feedback";

export const EXECUTION_METHODS = ["GET", "HEAD"] as const;
export type ExecutionMethod = (typeof EXECUTION_METHODS)[number];
export const EXECUTION_PLAN_TTL_MS = 5 * 60_000;
export const EXECUTION_OUTPUT_MAX_BYTES = 64 * 1024;
export const EXECUTION_PARAMETER_MAX_BYTES = 8 * 1024;

export type ExecutionStatus =
  | "READY"
  | "AUTH_REQUIRED"
  | "PARAMETER_REQUIRED"
  | "PAYMENT_REQUIRED"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "UNVERIFIED_EXTERNAL"
  | "BLOCKED";

type ParameterType = "string" | "number" | "integer" | "boolean";

type ExecutionParameterDefinition = {
  name: string;
  type: ParameterType;
  required: boolean;
  location: "query";
};

type ExecutionOperation = {
  method: ExecutionMethod;
  path: string;
  parameters: ExecutionParameterDefinition[];
  knownCost: { amount: number; currency: string } | null;
};

type ExecutionInput = {
  task?: string;
  serviceId?: string;
  operation?: {
    method?: string;
    path?: string;
  };
  parameters?: Record<string, unknown>;
};

export type ExecutionPlanResponse = {
  planId: string | null;
  expiresAt: string | null;
  status: ExecutionStatus;
  canExecute: boolean;
  service: {
    id: string | null;
    name: string | null;
  };
  operation: {
    method: string | null;
    path: string | null;
  };
  parameters: Record<string, unknown>;
  requiredParameters: string[];
  knownCost: { amount: number; currency: string } | null;
  candidate: AgentDecisionCandidate | null;
  decision: {
    contractVersion: string;
    intent: ReturnType<typeof normalizeAgentTask>;
    candidates: AgentDecisionCandidate[];
    why: string[];
    blockers: string[];
  };
  feedback: ReturnType<typeof createAgentFeedback>;
  nextAction: string;
};

export type ExecutionResponse = {
  requestId: string;
  planId: string | null;
  status: ExecutionStatus;
  code: string;
  service: { id: string | null; name: string | null };
  operation: { method: string | null; path: string | null };
  providerHttpStatus: number | null;
  latencyMs: number;
  retryable: boolean;
  retryAfterSeconds: number | null;
  cost: { amount: number; currency: string } | null;
  quota: ReturnType<typeof toUsageResponse> | null;
  data: unknown;
  nextAction: string;
  feedback: ReturnType<typeof createAgentFeedback>;
};

function digest(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function normalizeParameters(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function executionServiceConfigDigest(service: ApiServiceRow) {
  return digest({
    url: service.url,
    requestMethod: service.requestMethod,
    targetAuthType: service.targetAuthType,
    targetAuthSecretCiphertext: service.targetAuthSecretCiphertext,
    discoveryMetadata: service.discoveryMetadata,
    securityStatus: service.securityStatus,
    authRequirement: service.authRequirement,
  });
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function parseExecutionOperations(service: ApiServiceRow): ExecutionOperation[] {
  const registered = getRegisteredExecutionOperations(
    service.url,
    service.discoveryMetadata,
    {
      requireOperations: service.sourceType === "EXTERNAL_DISCOVERY",
      defaultMethod: service.requestMethod === "HEAD" ? "HEAD" : "GET",
    },
  );
  if (registered.length > 0) {
    return registered.map((operation) => ({
      method: operation.method,
      path: operation.path,
      parameters: operation.parameters,
      knownCost: operation.cost ?? null,
    }));
  }

  const metadata = service.discoveryMetadata;
  const hasDeclaredExecution =
    metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    "execution" in metadata;
  if (service.sourceType === "EXTERNAL_DISCOVERY" || hasDeclaredExecution) return [];

  const registeredUrl = new URL(service.url);
  const defaultOperation: ExecutionOperation = {
    method: service.requestMethod as ExecutionMethod,
    path: registeredUrl.pathname || "/",
    parameters: [],
    knownCost: null,
  };
  return [defaultOperation];
}

function executionOperation(service: ApiServiceRow, requested?: { method?: string; path?: string }) {
  const operations = parseExecutionOperations(service);
  const requestedMethod = requested?.method?.toUpperCase();
  const requestedPath = requested?.path;
  return operations.find((operation) =>
    (!requestedMethod || operation.method === requestedMethod) &&
    (!requestedPath || operation.path === requestedPath),
  ) ?? null;
}

function providerCredentialsConfigured(service: ApiServiceRow) {
  return service.targetAuthType === "NONE" || Boolean(service.targetAuthSecretCiphertext);
}

function providerAuthRequirement(service: ApiServiceRow) {
  return service.targetAuthType === "NONE" ? "NOT_REQUIRED" as const : "REQUIRED" as const;
}

function serviceCandidate(
  service: ApiServiceRow,
  task: string,
  operation: ExecutionOperation,
  checks: Awaited<ReturnType<typeof loadChecks>>,
): AgentCandidateInput {
  const intent = normalizeAgentTask(task);
  const searchText = `${service.name} ${service.url} ${service.expectedStructure}`.toLowerCase();
  const matchedTerms = intent.searchTerms.filter((term) => searchText.includes(term.toLowerCase()));
  const capabilityMatch = intent.capability === "UNKNOWN"
    ? (matchedTerms.length > 0 ? 45 : 0)
    : matchedTerms.length > 0 ? Math.min(100, 60 + matchedTerms.length * 15) : 0;
  const textMatch = matchedTerms.length > 0
    ? Math.min(100, matchedTerms.length * 25)
    : task.trim() && service.name.toLowerCase().includes(task.trim().toLowerCase())
      ? 80
      : 0;
  const preAction = evaluatePreAction(service, checks, "READ");
  const url = new URL(service.url);
  return {
    id: service.id,
    kind: "INTERNAL_SERVICE",
    name: service.name,
    description: service.expectedStructure,
    url: service.url,
    source: "BOND402_OWNER_CATALOG",
    sourceLabel: "Owner-gebundene Bond402-Servicekonfiguration",
    sourceUrl: service.sourceUrl ?? service.url,
    capabilityMatch,
    textMatch,
    openApiMetadata: operation.parameters.length > 0 ? 100 : 0,
    verificationStatus: service.securityStatus,
    trustStatus: service.securityStatus,
    trustScore: null,
    authRequirement: providerAuthRequirement(service),
    providerCredentialsConfigured: providerCredentialsConfigured(service),
    requiredParameters: operation.parameters.filter((parameter) => parameter.required).map((parameter) => parameter.name),
    safeOperations: [{
      method: operation.method,
      path: operation.path,
      url: `${url.origin}${operation.path}`,
      reason: "OWNER_REGISTERED_SERVICE_OPERATION",
    }],
    preActionDecision: preAction.decision,
    knownFacts: [
      "OWNER_BOUND_SERVICE",
      `SECURITY_STATUS:${service.securityStatus}`,
      `TARGET_AUTH_CONFIGURED:${providerCredentialsConfigured(service)}`,
      `SAFE_METHOD:${operation.method}`,
    ],
  };
}

function valueMatchesType(value: unknown, type: ParameterType) {
  if (type === "string") return typeof value === "string" && value.length <= 2_048;
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  return typeof value === "boolean";
}

function buildExecutionUrl(
  service: ApiServiceRow,
  operation: ExecutionOperation,
  parameters: Record<string, unknown>,
) {
  const url = new URL(service.url);
  const definitions = new Map(operation.parameters.map((parameter) => [parameter.name, parameter]));
  const invalidNames = Object.keys(parameters).filter((name) => !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name));
  if (invalidNames.length > 0) {
    return { url: null, status: "BLOCKED" as const, code: "PARAMETER_SCHEMA_INVALID", required: [], summary: "Mindestens ein Parametername entspricht nicht dem registrierten Schema." };
  }
  const unknown = Object.keys(parameters).filter((name) => !definitions.has(name));
  if (unknown.length > 0) {
    return { url: null, status: "BLOCKED" as const, code: "PARAMETERS_NOT_DECLARED", required: [], summary: "Es wurden Parameter ohne registrierte Schema-Deklaration angegeben." };
  }
  const missing = operation.parameters
    .filter((parameter) => parameter.required && !(parameter.name in parameters))
    .map((parameter) => parameter.name);
  if (missing.length > 0) {
    return { url: null, status: "PARAMETER_REQUIRED" as const, code: "PARAMETERS_REQUIRED", required: missing, summary: "Für die registrierte Operation fehlen erforderliche Parameter." };
  }
  for (const parameter of operation.parameters) {
    if (!(parameter.name in parameters)) continue;
    const value = parameters[parameter.name];
    if (!valueMatchesType(value, parameter.type)) {
      return { url: null, status: "BLOCKED" as const, code: "PARAMETER_SCHEMA_INVALID", required: [], summary: `Der Parameter ${parameter.name} entspricht nicht dem registrierten Typ.` };
    }
    url.searchParams.set(parameter.name, String(value));
  }
  if (Buffer.byteLength(JSON.stringify(parameters), "utf8") > EXECUTION_PARAMETER_MAX_BYTES) {
    return { url: null, status: "BLOCKED" as const, code: "PARAMETERS_TOO_LARGE", required: [], summary: "Die Parameter überschreiten das harte Bond402-Größenlimit." };
  }
  if (Buffer.byteLength(url.toString(), "utf8") > EXECUTION_PARAMETER_MAX_BYTES) {
    return { url: null, status: "BLOCKED" as const, code: "PARAMETERS_TOO_LARGE", required: [], summary: "Die zusammengesetzte Zielanfrage ist zu groß." };
  }
  return { url, status: "READY" as const, code: "READY", required: [], summary: "Die Parameter entsprechen der registrierten Query-Spezifikation." };
}

function statusForBlockers(
  candidate: AgentDecisionCandidate | null,
  extraStatus?: ExecutionStatus,
  parametersReady = false,
) {
  if (extraStatus) return extraStatus;
  if (!candidate) return "BLOCKED" as const;
  if (candidate.blockers.includes("UNVERIFIED_EXTERNAL")) return "UNVERIFIED_EXTERNAL" as const;
  if (candidate.blockers.includes("AUTH_REQUIRED")) return "AUTH_REQUIRED" as const;
  if (!parametersReady && candidate.blockers.includes("REQUIRED_PARAMETERS")) {
    return "PARAMETER_REQUIRED" as const;
  }
  return candidate.canExecute ? "READY" as const : "BLOCKED" as const;
}

function nextActionForStatus(status: ExecutionStatus) {
  switch (status) {
    case "READY":
      return "Den Plan mit derselben Developer-Key-Berechtigung ausführen; Quota und Rate-Limit werden unmittelbar vor dem Provider-Aufruf erneut geprüft.";
    case "AUTH_REQUIRED":
      return "Serverseitige Provider-Credentials owner-gebunden konfigurieren oder aktualisieren; keine Credentials in der Agent-Anfrage senden.";
    case "PARAMETER_REQUIRED":
      return "Nur die im Plan genannten fehlenden Parameter gemäß der registrierten Typdefinition ergänzen.";
    case "PAYMENT_REQUIRED":
      return "Quota oder Plan prüfen; keinen automatischen Retry-Loop starten.";
    case "RATE_LIMITED":
      return "Retry-After beachten und später erneut versuchen.";
    case "UNVERIFIED_EXTERNAL":
      return "Externen Treffer nicht ausführen; zuerst owner-gebunden registrieren und verifizieren.";
    case "PROVIDER_ERROR":
      return "Provider-Ergebnis prüfen und nur bei retryable=true später erneut versuchen.";
    default:
      return "Keine Provider-Anfrage senden; zuerst die angezeigten Blocker beheben.";
  }
}

function feedbackForExecution(
  status: ExecutionStatus,
  code: string,
  summary: string,
  input: {
    serviceId?: string | null;
    serviceName?: string | null;
    provider?: string | null;
    verification?: string | null;
    httpStatus?: number | null;
    retryAfterSeconds?: number | null;
    requiredParameters?: string[];
  } = {},
) {
  return createAgentFeedback({
    status: status as AgentFeedbackStatus,
    code,
    summary,
    nextAction: nextActionForStatus(status),
    ...input,
    source: "BOND402_OWNER_CATALOG",
    requiredAuth: status === "AUTH_REQUIRED" ? true : null,
    actionContext: "READ",
  });
}

function basePlanResponse(
  decision: ReturnType<typeof decideAgentTask>,
  status: ExecutionStatus,
  candidate: AgentDecisionCandidate | null,
  operation: ExecutionOperation | null,
  parameters: Record<string, unknown>,
  feedback: ReturnType<typeof createAgentFeedback>,
  extra: Partial<ExecutionPlanResponse> = {},
): ExecutionPlanResponse {
  return {
    planId: null,
    expiresAt: null,
    status,
    canExecute: status === "READY",
    service: {
      id: candidate?.id ?? null,
      name: candidate?.name ?? null,
    },
    operation: {
      method: operation?.method ?? null,
      path: operation?.path ?? null,
    },
    parameters,
    requiredParameters: decision.requiredParameters,
    knownCost: operation?.knownCost ?? null,
    candidate,
    decision: {
      contractVersion: decision.contractVersion,
      intent: decision.intent,
      candidates: decision.candidates,
      why: decision.why,
      blockers: decision.blockers,
    },
    feedback,
    nextAction: nextActionForStatus(status),
    ...extra,
  };
}

export async function buildExecutionPlan(
  ownerId: string,
  apiKeyId: string,
  input: ExecutionInput,
): Promise<ExecutionPlanResponse> {
  const parameters = normalizeParameters(input.parameters);
  const task = typeof input.task === "string" ? input.task.trim().slice(0, 500) : "";
  if (input.serviceId?.startsWith("external:")) {
    const decision = decideAgentTask(task, []);
    const feedback = feedbackForExecution(
      "UNVERIFIED_EXTERNAL",
      "UNVERIFIED_EXTERNAL",
      "Externe Discovery-Treffer sind nicht owner-gebunden und werden niemals direkt ausgeführt.",
    );
    return basePlanResponse(decision, "UNVERIFIED_EXTERNAL", null, null, parameters, feedback, {
      service: { id: input.serviceId, name: null },
    });
  }
  const service = input.serviceId ? await findOwnedService(input.serviceId, ownerId) : null;
  const services = service
    ? [service]
    : task
      ? await db.select().from(apiServicesTable).where(eq(apiServicesTable.ownerId, ownerId))
      : [];
  const intent = normalizeAgentTask(task || service?.name || "");
  const candidates: AgentCandidateInput[] = [];
  let selectedOperation: ExecutionOperation | null = null;
  for (const candidateService of services) {
    const operation = executionOperation(candidateService, input.operation);
    if (!operation) continue;
    const checks = await loadChecks(candidateService.id);
    candidates.push(serviceCandidate(candidateService, task || candidateService.name, operation, checks));
    if (service?.id === candidateService.id) selectedOperation = operation;
  }
  const decision = decideAgentTask(
    task || service?.name || "",
    candidates,
    Object.keys(parameters),
  );
  const candidate = decision.bestCandidate;
  if (!candidate) {
    const feedback = feedbackForExecution(
      "BLOCKED",
      service ? "OPERATION_NOT_FOUND" : "EXECUTION_NO_MATCH",
      service ? "Die angeforderte registrierte Operation wurde nicht gefunden." : "Für die natürliche Aufgabe wurde kein owner-gebundener Service gefunden.",
      { serviceId: service?.id ?? null, serviceName: service?.name ?? null },
    );
    return basePlanResponse(decision, "BLOCKED", null, selectedOperation, parameters, feedback);
  }

  const selectedService = services.find((item) => item.id === candidate.id);
  if (!selectedService) {
    const feedback = feedbackForExecution("BLOCKED", "SERVICE_NOT_FOUND", "Der ausgewählte Service ist nicht mehr verfügbar.");
    return basePlanResponse(decision, "BLOCKED", candidate, selectedOperation, parameters, feedback);
  }
  selectedOperation = executionOperation(selectedService, input.operation);
  if (!selectedOperation) {
    const feedback = feedbackForExecution("BLOCKED", "OPERATION_NOT_FOUND", "Die Operation ist für den registrierten Service nicht freigegeben.", {
      serviceId: selectedService.id,
      serviceName: selectedService.name,
      verification: selectedService.securityStatus,
    });
    return basePlanResponse(decision, "BLOCKED", candidate, null, parameters, feedback);
  }
  if (selectedOperation.method !== selectedService.requestMethod || !EXECUTION_METHODS.includes(selectedOperation.method)) {
    const feedback = feedbackForExecution("BLOCKED", "METHOD_NOT_ALLOWED", "Nur die registrierten sicheren GET-/HEAD-Operationen dürfen ausgeführt werden.", {
      serviceId: selectedService.id,
      serviceName: selectedService.name,
      verification: selectedService.securityStatus,
    });
    return basePlanResponse(decision, "BLOCKED", candidate, selectedOperation, parameters, feedback);
  }
  const registeredUrl = new URL(selectedService.url);
  if (registeredUrl.protocol !== "https:") {
    const feedback = feedbackForExecution("BLOCKED", "HTTPS_REQUIRED", "Produktive Execution benötigt eine registrierte HTTPS-Service-URL.", {
      serviceId: selectedService.id,
      serviceName: selectedService.name,
      verification: selectedService.securityStatus,
    });
    return basePlanResponse(decision, "BLOCKED", candidate, selectedOperation, parameters, feedback);
  }
  try {
    await validatePublicUrl(selectedService.url, Date.now() + 5_000);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "UNSAFE_URL";
    const feedback = feedbackForExecution("BLOCKED", code, "Das registrierte Service-Ziel ist für Outbound-Execution nicht öffentlich und sicher genug.", {
      serviceId: selectedService.id,
      serviceName: selectedService.name,
      verification: selectedService.securityStatus,
    });
    return basePlanResponse(decision, "BLOCKED", candidate, selectedOperation, parameters, feedback);
  }
  const built = buildExecutionUrl(selectedService, selectedOperation, parameters);
  if (built.status !== "READY") {
    const feedback = feedbackForExecution(built.status, built.code, built.summary, {
      serviceId: selectedService.id,
      serviceName: selectedService.name,
      verification: selectedService.securityStatus,
      requiredParameters: built.required,
    });
    return basePlanResponse(decision, built.status, candidate, selectedOperation, parameters, feedback, {
      requiredParameters: built.required,
    });
  }

  const status = statusForBlockers(candidate, undefined, built.status === "READY");
  const feedback = feedbackForExecution(
    status,
    status === "READY" ? "EXECUTION_PLAN_READY" : candidate.blockers[0] ?? "EXECUTION_BLOCKED",
    status === "READY"
      ? "Der owner-gebundene Execution-Plan ist für die registrierte read-only Operation zulässig."
      : "Der Execution-Plan ist aufgrund der bekannten Service-, Auth-, Quota- oder Sicherheitsfakten blockiert.",
    {
      serviceId: selectedService.id,
      serviceName: selectedService.name,
      provider: registeredUrl.hostname,
      verification: selectedService.securityStatus,
      requiredParameters: candidate.requiredParameters,
    },
  );
  if (status !== "READY") {
    return basePlanResponse(decision, status, candidate, selectedOperation, parameters, feedback);
  }

  const planId = randomUUID();
  const expiresAt = new Date(Date.now() + EXECUTION_PLAN_TTL_MS);
  await db.insert(executionPlansTable).values({
    id: planId,
    ownerId,
    apiKeyId,
    serviceId: selectedService.id,
    method: selectedOperation.method,
    path: selectedOperation.path,
    parametersDigest: digest(parameters),
    serviceConfigDigest: executionServiceConfigDigest(selectedService),
    status: "READY",
    expiresAt,
  });
  return basePlanResponse(decision, "READY", candidate, selectedOperation, parameters, feedback, {
    planId,
    expiresAt: expiresAt.toISOString(),
  });
}

function parseRetryAfter(headers: Record<string, string>) {
  const value = headers["retry-after"];
  if (!value) return null;
  if (/^\d+$/.test(value.trim())) return Number(value.trim());
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
}

function providerErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return "PROVIDER_ERROR";
  const code = String(error.code);
  if (code === "TARGET_AUTH_CONFIGURATION" || code === "TARGET_AUTH_UNAVAILABLE") return "AUTH_REQUIRED";
  return code;
}

function isRetryableProviderError(code: string) {
  return ["TIMEOUT", "UNREACHABLE", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code);
}

function isBlockedSafetyError(code: string) {
  return [
    "PRIVATE_ADDRESS",
    "UNSAFE_REDIRECT",
    "UNSAFE_URL",
    "TOO_MANY_REDIRECTS",
    "INVALID_URL",
    "TARGET_REQUEST_CONFIGURATION",
    "REQUEST_BODY_TOO_LARGE",
    "UNSUPPORTED_COMPRESSION",
    "INVALID_COMPRESSION",
  ].includes(code);
}

function redactObject(
  value: unknown,
  secret: string | null,
  budget: { remaining: number } = { remaining: EXECUTION_OUTPUT_MAX_BYTES },
): unknown {
  const consume = (text: string) => {
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes <= budget.remaining) {
      budget.remaining -= bytes;
      return text;
    }
    const clipped = Buffer.from(text, "utf8").subarray(0, Math.max(0, budget.remaining)).toString("utf8");
    budget.remaining = 0;
    return clipped ? `${clipped}…` : "[OUTPUT_TRUNCATED]";
  };
  if (budget.remaining <= 0) return "[OUTPUT_TRUNCATED]";
  if (typeof value === "string") {
    const redacted = secret ? value.split(secret).join("[REDACTED]") : value;
    return consume(redacted);
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactObject(item, secret, budget));
  if (!value || typeof value !== "object") return consume(JSON.stringify(value));
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value).slice(0, 100)) {
    if (budget.remaining <= 0) break;
    consume(`${JSON.stringify(key)}:`);
    if (/(authorization|cookie|password|passwd|secret|token|api[_-]?key|credential)/i.test(key)) {
      output[key] = "[REDACTED]";
      consume("[REDACTED]");
    } else {
      output[key] = redactObject(child, secret, budget);
    }
  }
  return output;
}

function safeProviderData(body: string, contentType: string | undefined, service: ApiServiceRow) {
  let secret: string | null = null;
  if (service.targetAuthSecretCiphertext) {
    try {
      secret = decryptTargetSecret(service.targetAuthSecretCiphertext);
    } catch {
      secret = null;
    }
  }
  if (body.length === 0) return null;
  const isJson = Boolean(contentType && /^(?:application\/json|application\/[^;]+\+json)\b/i.test(contentType));
  const parsed = isJson ? (() => {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  })() : body;
  return redactObject(parsed, secret);
}

function result(
  requestId: string,
  plan: ExecutionPlanRow | null,
  status: ExecutionStatus,
  code: string,
  service: ApiServiceRow | null,
  operation: { method: string | null; path: string | null },
  startedAt: number,
  input: {
    providerHttpStatus?: number | null;
    retryable?: boolean;
    retryAfterSeconds?: number | null;
    cost?: { amount: number; currency: string } | null;
    quota?: ReturnType<typeof toUsageResponse> | null;
    data?: unknown;
    summary: string;
  },
): ExecutionResponse {
  const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));
  const feedback = feedbackForExecution(status, code, input.summary, {
    serviceId: service?.id ?? plan?.serviceId ?? null,
    serviceName: service?.name ?? null,
    provider: service ? new URL(service.url).hostname : null,
    verification: service?.securityStatus ?? null,
    httpStatus: input.providerHttpStatus ?? null,
    retryAfterSeconds: input.retryAfterSeconds ?? null,
  });
  return {
    requestId,
    planId: plan?.id ?? null,
    status,
    code,
    service: { id: service?.id ?? plan?.serviceId ?? null, name: service?.name ?? null },
    operation,
    providerHttpStatus: input.providerHttpStatus ?? null,
    latencyMs,
    retryable: input.retryable ?? false,
    retryAfterSeconds: input.retryAfterSeconds ?? null,
    cost: input.cost ?? null,
    quota: input.quota ?? null,
    data: input.data ?? null,
    nextAction: nextActionForStatus(status),
    feedback,
  };
}

async function saveExecutionAudit(
  response: ExecutionResponse,
  ownerId: string,
  serviceId: string,
  operation: { method: string; path: string },
  startedAt: Date,
  parametersDigest: string,
  quotaUsed: number | null,
) {
  await db.insert(executionAuditTable).values({
    id: randomUUID(),
    requestId: response.requestId,
    planId: response.planId,
    ownerId,
    serviceId,
    operationMethod: operation.method,
    operationPath: operation.path,
    startedAt,
    endedAt: new Date(),
    durationMs: response.latencyMs,
    status: response.status,
    code: response.code,
    providerHttpStatus: response.providerHttpStatus,
    retryable: response.retryable ? "true" : "false",
    retryAfterSeconds: response.retryAfterSeconds,
    quotaUsed,
    parametersDigest,
    outputDigest: response.data === null ? null : digest(response.data),
  });
}

export async function executeAgentPlan(
  ownerId: string,
  apiKeyId: string,
  requestId: string,
  planId: string,
  parameters: unknown,
): Promise<ExecutionResponse> {
  const startedAt = performance.now();
  const startedDate = new Date();
  const normalizedParameters = normalizeParameters(parameters);
  const [plan] = await db
    .select()
    .from(executionPlansTable)
    .where(and(
      eq(executionPlansTable.id, planId),
      eq(executionPlansTable.ownerId, ownerId),
      eq(executionPlansTable.apiKeyId, apiKeyId),
    ));
  if (!plan) {
    return result(requestId, null, "BLOCKED", "EXECUTION_PLAN_NOT_FOUND", null, { method: null, path: null }, startedAt, {
      summary: "Der Execution-Plan ist nicht vorhanden oder nicht an diesen Developer-Key gebunden.",
    });
  }
  const service = await findOwnedService(plan.serviceId, ownerId);
  if (!service) {
    return result(requestId, plan, "BLOCKED", "SERVICE_NOT_FOUND", null, { method: plan.method, path: plan.path }, startedAt, {
      summary: "Der registrierte Service ist nicht mehr vorhanden.",
    });
  }
  if (plan.status !== "READY" || plan.consumedAt || plan.expiresAt.getTime() <= Date.now()) {
    const response = result(requestId, plan, "BLOCKED", "EXECUTION_PLAN_EXPIRED", service, { method: plan.method, path: plan.path }, startedAt, {
      summary: "Der Execution-Plan ist abgelaufen oder wurde bereits verwendet.",
    });
    await saveExecutionAudit(response, ownerId, service.id, { method: plan.method, path: plan.path }, startedDate, plan.parametersDigest, null);
    return response;
  }
  if (digest(normalizedParameters) !== plan.parametersDigest) {
    const response = result(requestId, plan, "BLOCKED", "EXECUTION_PLAN_PARAMETERS_CHANGED", service, { method: plan.method, path: plan.path }, startedAt, {
      summary: "Die Execute-Parameter stimmen nicht exakt mit dem vorher freigegebenen Plan überein.",
    });
    await saveExecutionAudit(response, ownerId, service.id, { method: plan.method, path: plan.path }, startedDate, plan.parametersDigest, null);
    return response;
  }
  if (executionServiceConfigDigest(service) !== plan.serviceConfigDigest) {
    const response = result(requestId, plan, "BLOCKED", "EXECUTION_CONFIGURATION_CHANGED", service, { method: plan.method, path: plan.path }, startedAt, {
      summary: "Die registrierte Service-Konfiguration hat sich seit PLAN geändert.",
    });
    await saveExecutionAudit(response, ownerId, service.id, { method: plan.method, path: plan.path }, startedDate, plan.parametersDigest, null);
    return response;
  }
  const operation = executionOperation(service, { method: plan.method, path: plan.path });
  if (!operation || operation.method !== plan.method || operation.path !== plan.path) {
    const response = result(requestId, plan, "BLOCKED", "EXECUTION_OPERATION_CHANGED", service, { method: plan.method, path: plan.path }, startedAt, {
      summary: "Die registrierte Operation hat sich seit PLAN geändert.",
    });
    await saveExecutionAudit(response, ownerId, service.id, { method: plan.method, path: plan.path }, startedDate, plan.parametersDigest, null);
    return response;
  }
  const built = buildExecutionUrl(service, operation, normalizedParameters);
  if (built.status !== "READY") {
    const response = result(requestId, plan, built.status, built.code, service, { method: operation.method, path: operation.path }, startedAt, {
      summary: built.summary,
    });
    await saveExecutionAudit(response, ownerId, service.id, operation, startedDate, plan.parametersDigest, null);
    return response;
  }
  const [claimed] = await db
    .update(executionPlansTable)
    .set({ consumedAt: new Date() })
    .where(and(
      eq(executionPlansTable.id, plan.id),
      eq(executionPlansTable.ownerId, ownerId),
      eq(executionPlansTable.apiKeyId, apiKeyId),
      isNull(executionPlansTable.consumedAt),
      gt(executionPlansTable.expiresAt, new Date()),
    ))
    .returning();
  if (!claimed) {
    const response = result(requestId, plan, "BLOCKED", "EXECUTION_PLAN_ALREADY_USED", service, { method: operation.method, path: operation.path }, startedAt, {
      summary: "Der Execution-Plan wurde bereits verwendet oder ist abgelaufen.",
    });
    await saveExecutionAudit(response, ownerId, service.id, operation, startedDate, plan.parametersDigest, null);
    return response;
  }
  const usage = await consumeMonthlyCheck(ownerId);
  if (!usage.allowed) {
    const response = result(requestId, plan, "PAYMENT_REQUIRED", "QUOTA_EXCEEDED", service, { method: operation.method, path: operation.path }, startedAt, {
      quota: usage.usage,
      summary: "Das monatliche Kontingent für produktive Execution ist aufgebraucht.",
    });
    await saveExecutionAudit(response, ownerId, service.id, operation, startedDate, plan.parametersDigest, usage.usage.usedChecks);
    return response;
  }

  try {
    const response = await safeGet(
      built.url.toString(),
      Math.min(10_000, Math.max(2_000, service.maxResponseTime + 2_000)),
      {
        ...getTargetRequestOptions(service),
        requestMethod: operation.method,
        requestBody: undefined,
      },
    );
    const contentType = response.headers["content-type"];
    const allowedContentType =
      operation.method === "HEAD" ||
      !response.body ||
      Boolean(contentType && (
        /^(?:application\/json|application\/[^;]+\+json)\b/i.test(contentType) ||
        /^text\/plain\b/i.test(contentType)
      ));
    if (response.status >= 200 && response.status < 300 && !allowedContentType) {
      const normalized = result(requestId, plan, "PROVIDER_ERROR", "UNSUPPORTED_CONTENT_TYPE", service, { method: operation.method, path: operation.path }, startedAt, {
        providerHttpStatus: response.status,
        quota: usage.usage,
        retryable: false,
        summary: "Die Provider-Antwort hat keinen zulässigen JSON- oder Text-Content-Type.",
      });
      await saveExecutionAudit(normalized, ownerId, service.id, operation, startedDate, plan.parametersDigest, usage.usage.usedChecks);
      return normalized;
    }
    const retryAfter = response.status === 429 ? parseRetryAfter(response.headers) : null;
    const responseData = safeProviderData(response.body, contentType, service);
    const status: ExecutionStatus = response.status === 429
      ? "RATE_LIMITED"
      : response.status >= 200 && response.status < 300
        ? "READY"
        : response.status === 401 || response.status === 403
          ? "AUTH_REQUIRED"
          : [404, 405, 410].includes(response.status)
            ? "BLOCKED"
            : "PROVIDER_ERROR";
    const code =
      status === "READY"
        ? "EXECUTION_COMPLETED"
        : status === "RATE_LIMITED"
          ? "PROVIDER_RATE_LIMITED"
          : status === "AUTH_REQUIRED"
            ? "PROVIDER_AUTH_REJECTED"
            : status === "BLOCKED"
              ? "OPERATION_NOT_APPLICABLE"
            : response.status >= 500
              ? "PROVIDER_5XX"
              : "PROVIDER_HTTP_ERROR";
    const normalized = result(requestId, plan, status, code, service, { method: operation.method, path: operation.path }, startedAt, {
      providerHttpStatus: response.status,
      retryable: status === "RATE_LIMITED" || response.status >= 500,
      retryAfterSeconds: retryAfter,
      quota: usage.usage,
      data: status === "READY" ? responseData : null,
      cost: operation.knownCost,
      summary:
        status === "READY"
          ? "Der registrierte Provider wurde über die freigegebene read-only Operation aufgerufen."
          : status === "RATE_LIMITED"
            ? "Der Provider hat das Kontingent oder Rate-Limit signalisiert."
            : status === "AUTH_REQUIRED"
              ? "Der Provider hat die serverseitige Authentifizierung abgelehnt."
              : status === "BLOCKED"
                ? "Der Provider ist erreichbar, aber die registrierte Operation ist für diese Antwort nicht geeignet."
              : "Der Provider-Aufruf ist mit einem kontrollierten HTTP-Fehler fehlgeschlagen.",
    });
    await saveExecutionAudit(normalized, ownerId, service.id, operation, startedDate, plan.parametersDigest, usage.usage.usedChecks);
    return normalized;
  } catch (error) {
    const code = providerErrorCode(error);
    const status: ExecutionStatus =
      code === "AUTH_REQUIRED"
        ? "AUTH_REQUIRED"
        : isBlockedSafetyError(code)
          ? "BLOCKED"
          : isRetryableProviderError(code)
            ? "PROVIDER_ERROR"
          : "PROVIDER_ERROR";
    const retryable = isRetryableProviderError(code);
    const normalized = result(requestId, plan, status, code, service, { method: operation.method, path: operation.path }, startedAt, {
      quota: usage.usage,
      retryable,
      summary:
        status === "AUTH_REQUIRED"
          ? "Die serverseitige Provider-Authentifizierung ist nicht verfügbar."
          : code === "RESPONSE_TOO_LARGE"
            ? "Die Provider-Antwort überschreitet das harte Bond402-Größenlimit."
            : code === "UNSAFE_REDIRECT" || code === "PRIVATE_ADDRESS"
              ? "Der Outbound-Sicherheitsschutz hat das Provider-Ziel blockiert."
              : "Der Provider-Aufruf konnte nicht sicher abgeschlossen werden.",
    });
    await saveExecutionAudit(normalized, ownerId, service.id, operation, startedDate, plan.parametersDigest, usage.usage.usedChecks);
    return normalized;
  }
}