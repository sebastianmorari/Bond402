export const AGENT_FEEDBACK_CONTRACT_VERSION = "2026-09-14" as const;

export const AGENT_FEEDBACK_STATUSES = [
  "READY",
  "CAUTION",
  "AUTH_REQUIRED",
  "PARAMETER_REQUIRED",
  "PAYMENT_REQUIRED",
  "RATE_LIMITED",
  "PROVIDER_ERROR",
  "UNVERIFIED_EXTERNAL",
  "BLOCKED",
  "NOT_FOUND",
  "NO_MATCH",
  "INVALID_REQUEST",
  "INTERNAL_ERROR",
] as const;

export type AgentFeedbackStatus = (typeof AGENT_FEEDBACK_STATUSES)[number];

export type AgentFeedbackContext = {
  serviceId: string | null;
  serviceName: string | null;
  provider: string | null;
  source: string | null;
  verification: string | null;
};

export type AgentFeedback = {
  contractVersion: typeof AGENT_FEEDBACK_CONTRACT_VERSION;
  status: AgentFeedbackStatus;
  code: string;
  summary: string;
  nextAction: string;
  context: AgentFeedbackContext;
  details: {
    httpStatus: number | null;
    retryAfterSeconds: number | null;
    requiredAuth: boolean | null;
    requiredParameters: string[];
    actionContext: string | null;
  };
};

export function createAgentFeedback(input: {
  status: AgentFeedbackStatus;
  code: string;
  summary: string;
  nextAction: string;
  serviceId?: string | null;
  serviceName?: string | null;
  provider?: string | null;
  source?: string | null;
  verification?: string | null;
  httpStatus?: number | null;
  retryAfterSeconds?: number | null;
  requiredAuth?: boolean | null;
  requiredParameters?: readonly string[];
  actionContext?: string | null;
}): AgentFeedback {
  return {
    contractVersion: AGENT_FEEDBACK_CONTRACT_VERSION,
    status: input.status,
    code: input.code,
    summary: input.summary,
    nextAction: input.nextAction,
    context: {
      serviceId: input.serviceId ?? null,
      serviceName: input.serviceName ?? null,
      provider: input.provider ?? null,
      source: input.source ?? null,
      verification: input.verification ?? null,
    },
    details: {
      httpStatus: input.httpStatus ?? null,
      retryAfterSeconds: input.retryAfterSeconds ?? null,
      requiredAuth: input.requiredAuth ?? null,
      requiredParameters: [...(input.requiredParameters ?? [])].slice(0, 32),
      actionContext: input.actionContext ?? null,
    },
  };
}

export function feedbackForDecision(
  decision: "ALLOW" | "CAUTION" | "BLOCK",
  input: Omit<Parameters<typeof createAgentFeedback>[0], "status" | "code" | "summary" | "nextAction">,
) {
  if (decision === "ALLOW") {
    return createAgentFeedback({
      ...input,
      status: "READY",
      code: "PRE_ACTION_ALLOW",
      summary: "Die gespeicherten Bond402-Signale erlauben die angefragte Aktion.",
      nextAction: "Eigene Domain-, Berechtigungs-, Datenschutz- und Geschäftsregeln zusätzlich prüfen.",
    });
  }
  if (decision === "CAUTION") {
    return createAgentFeedback({
      ...input,
      status: "CAUTION",
      code: "PRE_ACTION_CAUTION",
      summary: "Die Aktion ist nur mit zusätzlicher Prüfung vertretbar.",
      nextAction: "Die angegebenen Gründe und aktuellen Signale prüfen, bevor die Aktion ausgeführt wird.",
    });
  }
  return createAgentFeedback({
    ...input,
    status: "BLOCKED",
    code: "PRE_ACTION_BLOCK",
    summary: "Bond402 blockiert die angefragte Aktion aufgrund gespeicherter Risiken oder fehlender Nachweise.",
    nextAction: "Keine Aktion ausführen; zuerst die angezeigten Gründe beheben oder manuell klären.",
  });
}

export function feedbackForVerificationOutcome(input: {
  classification: string;
  status: "PASS" | "FAIL" | "REVIEW";
  httpStatus: number | null;
  errorCode: string | null;
  summary: string;
  retryAfterSeconds?: number | null;
  serviceId?: string | null;
  serviceName?: string | null;
  provider?: string | null;
  verification?: string | null;
}) {
  const status: AgentFeedbackStatus =
    input.classification === "AUTH_REQUIRED"
      ? "AUTH_REQUIRED"
      : input.classification === "RATE_LIMITED"
        ? "RATE_LIMITED"
        : input.classification === "PROVIDER_ERROR" || input.classification === "NETWORK_UNAVAILABLE"
          ? "PROVIDER_ERROR"
          : input.classification === "SUCCESS" && input.status === "PASS"
            ? "READY"
            : "CAUTION";
  const code =
    input.classification === "SUCCESS"
      ? input.status === "PASS" ? "LIVE_CHECK_READY" : "LIVE_CHECK_REVIEW"
      : input.errorCode ?? `LIVE_${input.classification}`;
  const nextAction =
    status === "READY"
      ? "Die gespeicherten Beobachtungen können für die nächste Trust- und Pre-Action-Bewertung verwendet werden."
      : status === "AUTH_REQUIRED"
        ? "Provider-Authentifizierung oder Berechtigung prüfen; keine Credentials in einer Agent-Antwort senden."
        : status === "RATE_LIMITED"
          ? "Retry-After beachten und den Check später erneut ausführen."
          : status === "PROVIDER_ERROR"
            ? "Provider-, Netzwerk- oder Timeout-Fehler prüfen und nur bei retryable=true erneut versuchen."
            : "Endpoint, erwartete Antwortstruktur und registrierte Operation prüfen; keine Werte erfinden.";
  return createAgentFeedback({
    status,
    code,
    summary: input.summary,
    nextAction,
    serviceId: input.serviceId,
    serviceName: input.serviceName,
    provider: input.provider,
    source: "BOND402_OWNER_CATALOG",
    verification: input.verification ?? "BOND402_OBSERVED",
    httpStatus: input.httpStatus,
    retryAfterSeconds: input.retryAfterSeconds,
    requiredAuth: status === "AUTH_REQUIRED",
    actionContext: "READ",
  });
}

export function feedbackForHttpError(
  status: number,
  code: string,
  summary: string,
  input: Partial<Pick<Parameters<typeof createAgentFeedback>[0], "serviceId" | "serviceName" | "provider" | "source" | "verification">> & {
    retryAfterSeconds?: number | null;
    nextAction?: string;
  } = {},
) {
  const feedbackStatus: AgentFeedbackStatus =
    status === 404
      ? "NOT_FOUND"
      : status === 429
        ? "RATE_LIMITED"
        : status >= 500
          ? "PROVIDER_ERROR"
          : "INVALID_REQUEST";
  return createAgentFeedback({
    ...input,
    status: feedbackStatus,
    code,
    summary,
    nextAction:
      input.nextAction ??
      (feedbackStatus === "RATE_LIMITED"
        ? "Retry-After beachten und später erneut versuchen."
        : feedbackStatus === "NOT_FOUND"
          ? "Service-ID oder Discovery-Treffer prüfen."
          : feedbackStatus === "PROVIDER_ERROR"
            ? "Später erneut versuchen; keine Credentials erneut senden."
            : "Anfrage anhand der maschinenlesbaren Fehlermeldung korrigieren."),
    httpStatus: status,
  });
}