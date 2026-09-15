import { and, eq } from "drizzle-orm";
import { apiServicesTable, db } from "@workspace/db";
import {
  decideAgentTask,
  normalizeAgentTask,
  type AgentAuthRequirement,
  type AgentCandidateInput,
  type AgentDecisionCandidate,
} from "./agent-decision";
import {
  PUBLIC_EXTERNAL_DISCOVERY_SOURCE_URL,
  PUBLIC_API_DIRECTORY_SOURCE_URL,
  dedupeExternalDiscoveryRecords,
  getCachedApisGuruCatalog,
  getCachedPublicApisCatalog,
  loadApisGuruCatalog,
  loadPublicApisCatalog,
  rankExternalDiscoveryResults,
  type ExternalApiRecord,
} from "./public-external-discovery";
import {
  loadPublicDiscoveryRecords,
  publicDiscoveryCandidateFromExternalRecord,
  refreshPublicDiscoveryRecords,
} from "./public-internal-discovery";
import {
  rankPublicDiscoveryResults,
  rankPublicServiceResults,
  shouldUseExternalDiscoveryFallback,
} from "./public-service-search";
import { getExternalApiDetail } from "./public-external-detail";
import { evaluatePreAction } from "./pre-action";
import { loadChecks, toPublicServiceResponse } from "./service-data";
import { createAgentFeedback } from "./agent-feedback";

export const PUBLIC_AGENT_DECISION_PATH = "/public/agent/decision" as const;
export const PUBLIC_AGENT_DECISION_SERVICE_SECURITY_STATUS = "VERIFIED_LOW_RISK" as const;
export const PUBLIC_AGENT_DECISION_MAX_EXTERNAL_DETAILS = 8;

const AGENT_AUTH_REQUIREMENTS = [
  "REQUIRED",
  "NOT_REQUIRED",
  "NOT_DECLARED",
  "UNKNOWN",
] as const;

type RankedMatch = {
  matchScore: number;
  textRelevance: number;
  openApiMetadata: number;
};

type RankedExternalItem = ReturnType<typeof rankExternalDiscoveryResults>[number];

type PublicAgentDecisionResult = ReturnType<typeof decideAgentTask> & {
  provenance: {
    mode: "INTERNAL_PRIMARY" | "EXTERNAL_FALLBACK";
    sources: Array<{
      kind: AgentCandidateInput["kind"];
      source: string;
      sourceLabel: string;
      sourceUrl: string | null;
    }>;
    externalCandidatesAlwaysUnverified: true;
  };
};

function unique(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function authRequirement(value: unknown): AgentAuthRequirement {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "UNKNOWN";
  return AGENT_AUTH_REQUIREMENTS.includes(normalized as (typeof AGENT_AUTH_REQUIREMENTS)[number])
    ? normalized as AgentAuthRequirement
    : "UNKNOWN";
}

function maxRankedMatches(
  terms: readonly string[],
  ranker: (term: string) => Array<{
    id: string;
    discovery: {
      matchScore: number;
      rankingFactors: {
        textRelevance: number;
        openApiMetadata?: number;
      };
    };
  }>,
) {
  const matches = new Map<string, RankedMatch>();
  for (const term of unique(terms)) {
    if (!term) continue;
    for (const result of ranker(term)) {
      const next: RankedMatch = {
        matchScore: result.discovery.matchScore,
        textRelevance: result.discovery.rankingFactors.textRelevance * 100,
        openApiMetadata: (result.discovery.rankingFactors.openApiMetadata ?? 0) * 100,
      };
      const current = matches.get(result.id);
      if (
        !current ||
        next.matchScore > current.matchScore ||
        (next.matchScore === current.matchScore && next.textRelevance > current.textRelevance)
      ) {
        matches.set(result.id, next);
      }
    }
  }
  return matches;
}

function internalKnownFacts(
  service: {
    securityStatus: string;
    authRequirement: string;
  },
  checks: readonly unknown[],
  preActionDecision: string,
) {
  return unique([
    "LISTED_INTERNAL_SERVICE",
    `SECURITY_STATUS:${service.securityStatus}`,
    `TARGET_AUTH_STATUS:${service.authRequirement}`,
    `LIVE_OBSERVATIONS:${checks.length}`,
    `PRE_ACTION_DECISION:${preActionDecision}`,
  ]);
}

function persistedKnownFacts(item: {
  verification: { status: string };
  trust: { status: string };
  discovery: { source: string };
}) {
  return unique([
    "PERSISTED_PUBLIC_DISCOVERY",
    `SOURCE:${item.discovery.source}`,
    `VERIFICATION_STATUS:${item.verification.status}`,
    `TRUST_STATUS:${item.trust.status}`,
  ]);
}

function externalKnownFacts(
  item: RankedExternalItem,
  detail: Awaited<ReturnType<typeof getExternalApiDetail>>,
) {
  return unique([
    "EXTERNAL_METADATA_ONLY",
    "UNVERIFIED_EXTERNAL",
    `SOURCE:${item.discovery.source}`,
    `OPENAPI_STATUS:${detail?.specification.status ?? "NOT_LOADED"}`,
    ...(detail ? [`SAFE_READ_OPERATIONS:${detail.safeEndpoints.length}`] : []),
  ]);
}

function externalCandidate(
  item: RankedExternalItem,
  match: RankedMatch,
  detail: Awaited<ReturnType<typeof getExternalApiDetail>>,
): AgentCandidateInput {
  const safeOperations = (detail?.safeEndpoints ?? []).map((operation) => ({
    method: operation.method,
    path: operation.path,
    url: operation.url,
    reason: operation.reason,
  }));

  return {
    id: item.id,
    kind: "EXTERNAL_DISCOVERY",
    name: item.name,
    description: item.description,
    url: item.url,
    source: item.discovery.source,
    sourceLabel: item.discovery.sourceLabel,
    sourceUrl: item.discovery.evidence.sourceRecordUrl,
    capabilityMatch: match.matchScore,
    textMatch: match.textRelevance,
    openApiMetadata: match.openApiMetadata,
    verificationStatus: "UNVERIFIED_EXTERNAL",
    trustStatus: "UNKNOWN",
    trustScore: null,
    authRequirement: authRequirement(detail?.specification.auth.status),
    requiredParameters: [],
    safeOperations,
    preActionDecision: null,
    knownFacts: externalKnownFacts(item, detail),
  };
}

function decisionFeedback(decision: ReturnType<typeof decideAgentTask>) {
  const candidate = decision.bestCandidate;
  if (!candidate) {
    return {
      status: "NO_MATCH" as const,
      code: "AGENT_DECISION_NO_MATCH",
      summary: "Für die natürliche Aufgabe wurde kein Kandidat mit belegbaren Fakten gefunden.",
      nextAction: decision.nextAction,
      serviceId: null,
      serviceName: null,
      source: null,
      verification: "UNKNOWN",
      requiredParameters: decision.requiredParameters,
    };
  }

  if (candidate.blockers.includes("UNVERIFIED_EXTERNAL")) {
    return {
      status: "UNVERIFIED_EXTERNAL" as const,
      code: "AGENT_DECISION_EXTERNAL_UNVERIFIED",
      summary: "Der beste Treffer stammt aus externer Discovery und ist nicht durch Bond402 verifiziert.",
      nextAction: decision.nextAction,
      serviceId: candidate.id,
      serviceName: candidate.name,
      provider: candidate.source,
      source: candidate.source,
      verification: "UNVERIFIED_EXTERNAL",
      requiredParameters: decision.requiredParameters,
    };
  }

  if (candidate.blockers.includes("AUTH_REQUIRED")) {
    return {
      status: "AUTH_REQUIRED" as const,
      code: "AGENT_DECISION_AUTH_REQUIRED",
      summary: "Der Kandidat verlangt Authentifizierung; Bond402 verwendet keine erfundenen Credentials.",
      nextAction: decision.nextAction,
      serviceId: candidate.id,
      serviceName: candidate.name,
      provider: candidate.source,
      source: candidate.source,
      verification: candidate.verificationStatus,
      requiredAuth: true,
      requiredParameters: decision.requiredParameters,
    };
  }

  if (candidate.blockers.includes("REQUIRED_PARAMETERS")) {
    return {
      status: "PARAMETER_REQUIRED" as const,
      code: "AGENT_DECISION_PARAMETERS_REQUIRED",
      summary: "Für den Kandidaten fehlen bekannte erforderliche Parameter.",
      nextAction: decision.nextAction,
      serviceId: candidate.id,
      serviceName: candidate.name,
      provider: candidate.source,
      source: candidate.source,
      verification: candidate.verificationStatus,
      requiredParameters: decision.requiredParameters,
    };
  }

  return {
    status: candidate.canExecute ? ("READY" as const) : ("BLOCKED" as const),
    code: candidate.canExecute ? "AGENT_DECISION_READY" : "AGENT_DECISION_BLOCKED",
    summary: candidate.canExecute
      ? "Der Kandidat erfüllt die bekannten Decision-Fakten; die konkrete Aktion muss weiterhin separat autorisiert werden."
      : "Der Kandidat ist anhand der bekannten Fakten nicht ausführbar.",
    nextAction: decision.nextAction,
    serviceId: candidate.id,
    serviceName: candidate.name,
    provider: candidate.source,
    source: candidate.source,
    verification: candidate.verificationStatus,
    requiredParameters: decision.requiredParameters,
  };
}

export function buildPublicAgentFeedback(decision: ReturnType<typeof decideAgentTask>) {
  const input = decisionFeedback(decision);
  return createAgentFeedback({
    status: input.status,
    code: input.code,
    summary: input.summary,
    nextAction: input.nextAction,
    serviceId: input.serviceId,
    serviceName: input.serviceName,
    provider: "provider" in input ? input.provider : null,
    source: input.source,
    verification: input.verification,
    requiredAuth: "requiredAuth" in input ? input.requiredAuth : null,
    requiredParameters: input.requiredParameters,
    actionContext: "GENERAL",
  });
}

export async function buildPublicAgentDecision(task: string): Promise<PublicAgentDecisionResult> {
  const intent = normalizeAgentTask(task);
  const services = await db
    .select()
    .from(apiServicesTable)
    .where(
      and(
        eq(apiServicesTable.visibility, "LISTED"),
        eq(apiServicesTable.securityStatus, PUBLIC_AGENT_DECISION_SERVICE_SECURITY_STATUS),
      ),
    );
  const internalEntries = await Promise.all(
    services.map(async (service) => {
      const checks = await loadChecks(service.id);
      return {
        service,
        checks,
        publicService: toPublicServiceResponse(service, checks),
        preAction: evaluatePreAction(service, checks, "GENERAL"),
      };
    }),
  );
  const persistedRecords = await loadPublicDiscoveryRecords();
  const publicServices = internalEntries.map((entry) => entry.publicService);

  const internalMatches = maxRankedMatches(intent.searchTerms, (term) =>
    rankPublicServiceResults(publicServices, term),
  );
  const persistedResults = maxRankedMatches(intent.searchTerms, (term) =>
    rankPublicDiscoveryResults(persistedRecords, term),
  );
  const publicServiceById = new Map(internalEntries.map((entry) => [entry.service.id, entry]));
  const persistedById = new Map(
    persistedRecords.map((record) => [record.id, record]),
  );

  const candidates: AgentCandidateInput[] = [];
  for (const [id, match] of internalMatches) {
    const entry = publicServiceById.get(id);
    if (!entry) continue;
    candidates.push({
      id: entry.service.id,
      kind: "INTERNAL_SERVICE",
      name: entry.service.name,
      description: null,
      url: entry.service.url,
      source: "BOND402_INTERNAL_CATALOG",
      sourceLabel: "Interne Bond402-Katalogdaten",
      sourceUrl: entry.service.sourceUrl ?? entry.service.url,
      capabilityMatch: intent.capability === "UNKNOWN" ? 0 : match.matchScore,
      textMatch: match.textRelevance,
      openApiMetadata: 0,
      verificationStatus: entry.service.securityStatus,
      trustStatus: entry.service.securityStatus,
      trustScore: entry.publicService.trustScore,
      authRequirement: authRequirement(entry.service.authRequirement),
      requiredParameters: [],
      safeOperations: [],
      preActionDecision: entry.preAction.decision,
      knownFacts: internalKnownFacts(
        entry.service,
        entry.checks,
        entry.preAction.decision,
      ),
    });
  }

  for (const [id, match] of persistedResults) {
    const record = persistedById.get(id);
    if (!record) continue;
    const [item] = rankPublicDiscoveryResults([record], intent.searchTerms[0] ?? task);
    if (!item) continue;
    candidates.push({
      id: item.id,
      kind: "PERSISTED_DISCOVERY",
      name: item.name,
      description: item.description,
      url: item.url,
      source: item.discovery.source,
      sourceLabel: item.discovery.sourceLabel,
      sourceUrl: item.discovery.evidence.sourceUrl,
      capabilityMatch: intent.capability === "UNKNOWN" ? 0 : match.matchScore,
      textMatch: match.textRelevance,
      openApiMetadata: 0,
      verificationStatus: item.verification.status,
      trustStatus: item.trust.status,
      trustScore: null,
      authRequirement: "UNKNOWN",
      requiredParameters: [],
      safeOperations: [],
      preActionDecision: null,
      knownFacts: persistedKnownFacts(item),
    });
  }

  const fallbackInternalMatches = [...internalMatches.entries()].map(([id, match]) => ({
    id,
    discovery: {
      matchScore: match.matchScore,
      rankingFactors: {
        textRelevance: match.textRelevance / 100,
        observationCoverage: publicServiceById.get(id)?.publicService.trustMetrics.sampleCount
          ? 1
          : 0,
        observationFreshness: 0,
        publicSource: 1,
      },
    },
  }));
  const fallbackPersistedMatches = [...persistedResults.entries()].map(([id, match]) => ({
    id,
    discovery: { rankingFactors: { textRelevance: match.textRelevance / 100 } },
  }));
  const shouldUseExternal = shouldUseExternalDiscoveryFallback(
    task,
    fallbackInternalMatches,
    fallbackPersistedMatches,
  );

  let mode: "INTERNAL_PRIMARY" | "EXTERNAL_FALLBACK" = "INTERNAL_PRIMARY";
  if (shouldUseExternal) {
    mode = "EXTERNAL_FALLBACK";
    const cachedApisGuru = getCachedApisGuruCatalog();
    const cachedPublicApis = getCachedPublicApisCatalog();
    const [apisGuru, publicApis] = await Promise.all([
      cachedApisGuru.status === "AVAILABLE" ? cachedApisGuru : loadApisGuruCatalog(),
      cachedPublicApis.status === "AVAILABLE" ? cachedPublicApis : loadPublicApisCatalog(),
    ]);
    const externalRecords = dedupeExternalDiscoveryRecords(
      [...apisGuru.records, ...publicApis.records],
      [
        ...publicServices.map((service) => service.url),
        ...persistedRecords.map((record) => record.canonicalUrl),
      ],
    );
    await refreshPublicDiscoveryRecords(
      externalRecords
        .map(publicDiscoveryCandidateFromExternalRecord)
        .filter((candidate): candidate is NonNullable<ReturnType<typeof publicDiscoveryCandidateFromExternalRecord>> =>
          Boolean(candidate),
        ),
      [PUBLIC_EXTERNAL_DISCOVERY_SOURCE_URL, PUBLIC_API_DIRECTORY_SOURCE_URL],
    );
    const externalMatches = maxRankedMatches(intent.searchTerms, (term) =>
      rankExternalDiscoveryResults(externalRecords, term),
    );
    const externalItems = new Map<string, RankedExternalItem>();
    for (const term of intent.searchTerms) {
      for (const item of rankExternalDiscoveryResults(externalRecords, term)) {
        if (!externalItems.has(item.id)) externalItems.set(item.id, item);
      }
    }
    const externalIds = [...externalMatches.keys()].slice(0, PUBLIC_AGENT_DECISION_MAX_EXTERNAL_DETAILS);
    const externalDetails = await Promise.all(
      externalIds.map(async (id) => [id, await getExternalApiDetail(id)] as const),
    );
    const detailById = new Map(externalDetails);
    for (const id of externalIds) {
      const item = externalItems.get(id);
      const match = externalMatches.get(id);
      if (item && match) candidates.push(externalCandidate(item, match, detailById.get(id) ?? null));
    }
  }

  const decision = decideAgentTask(task, candidates);
  const sources = [...new Map(
    decision.candidates.map((candidate: AgentDecisionCandidate) => [
      `${candidate.kind}:${candidate.source}:${candidate.sourceUrl ?? ""}`,
      {
        kind: candidate.kind,
        source: candidate.source,
        sourceLabel: candidate.sourceLabel,
        sourceUrl: candidate.sourceUrl,
      },
    ]),
  ).values()].sort((left, right) =>
    `${left.kind}:${left.source}:${left.sourceUrl ?? ""}`.localeCompare(
      `${right.kind}:${right.source}:${right.sourceUrl ?? ""}`,
    ),
  );

  return {
    ...decision,
    provenance: {
      mode,
      sources,
      externalCandidatesAlwaysUnverified: true,
    },
  };
}
