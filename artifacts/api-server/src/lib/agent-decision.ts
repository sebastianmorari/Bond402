import type { AgentFeedback } from "./agent-feedback";

export const AGENT_DECISION_CONTRACT_VERSION = "2026-09-15" as const;

export const AGENT_CAPABILITIES = [
  "WEATHER",
  "IMAGE_GENERATION",
  "FOOTBALL_RESULTS",
  "CURRENCY_CONVERSION",
  "UNKNOWN",
] as const;

export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];
export type AgentAuthRequirement = "REQUIRED" | "NOT_REQUIRED" | "NOT_DECLARED" | "UNKNOWN";
export type AgentCandidateKind =
  | "INTERNAL_SERVICE"
  | "PERSISTED_DISCOVERY"
  | "EXTERNAL_DISCOVERY";

export type AgentIntent = {
  task: string;
  capability: AgentCapability;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  matchedTerms: string[];
  searchTerms: string[];
  parameterHints: string[];
  reason: string;
};

export type AgentSafeOperation = {
  method: string;
  path: string;
  url: string | null;
  reason: string;
};

export type AgentCandidateInput = {
  id: string;
  kind: AgentCandidateKind;
  name: string;
  description: string | null;
  url: string;
  source: string;
  sourceLabel: string;
  sourceUrl: string | null;
  capabilityMatch: number;
  textMatch: number;
  openApiMetadata: number;
  verificationStatus: string;
  trustStatus: string | null;
  trustScore: number | null;
  authRequirement: AgentAuthRequirement;
  providerCredentialsConfigured?: boolean;
  requiredParameters: string[];
  safeOperations: AgentSafeOperation[];
  preActionDecision: "ALLOW" | "CAUTION" | "BLOCK" | null;
  knownFacts: string[];
};

export type AgentDecisionCandidate = AgentCandidateInput & {
  selectionScore: number;
  blockers: string[];
  canExecute: boolean;
};

const CAPABILITY_DEFINITIONS: Array<{
  capability: Exclude<AgentCapability, "UNKNOWN">;
  terms: string[];
  searchTerms: string[];
  parameterHints: string[];
}> = [
  {
    capability: "WEATHER",
    terms: ["weather", "wetter", "forecast", "vorhersage", "temperatur", "temperature", "regen", "rain"],
    searchTerms: ["weather", "wetter", "forecast", "meteorology"],
    parameterHints: ["location"],
  },
  {
    capability: "IMAGE_GENERATION",
    terms: [
      "image generation",
      "image",
      "bilder",
      "bild",
      "bildgenerierung",
      "bild generieren",
      "text to image",
      "text-to-image",
      "text2image",
      "illustration",
    ],
    searchTerms: ["image generation", "image", "bild", "text to image", "illustration"],
    parameterHints: ["prompt"],
  },
  {
    capability: "FOOTBALL_RESULTS",
    terms: [
      "football",
      "fussball",
      "fußball",
      "soccer",
      "football results",
      "fußballergebnisse",
      "fussballergebnisse",
      "spielstand",
      "spielstände",
      "match result",
      "match results",
    ],
    searchTerms: ["football", "soccer", "fussball", "fußball", "football results", "match results"],
    parameterHints: ["teamOrMatch", "date"],
  },
  {
    capability: "CURRENCY_CONVERSION",
    terms: [
      "currency",
      "währung",
      "waehrung",
      "exchange rate",
      "wechselkurs",
      "convert",
      "convert currency",
      "währung umrechnen",
      "waehrung umrechnen",
      "currency conversion",
      "geld umrechnen",
    ],
    searchTerms: ["currency", "währung", "exchange rate", "currency conversion", "forex"],
    parameterHints: ["amount", "fromCurrency", "toCurrency"],
  },
];

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

function unique(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function taskTokens(value: string) {
  return normalize(value).split(/[^a-z0-9]+/).filter(Boolean);
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sourcePriority(kind: AgentCandidateKind) {
  return kind === "INTERNAL_SERVICE" ? 3 : kind === "PERSISTED_DISCOVERY" ? 2 : 1;
}

function canonicalCandidateUrl(value: string) {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return value.trim().toLowerCase();
  }
}

function verificationPriority(status: string) {
  const normalized = normalize(status);
  if (normalized === "verified_low_risk" || normalized === "verified") return 1;
  if (normalized === "unverified_external") return 0;
  return 0.25;
}

function blockersForCandidate(candidate: AgentCandidateInput) {
  const blockers: string[] = [];
  if (candidate.kind === "EXTERNAL_DISCOVERY" || normalize(candidate.verificationStatus) === "unverified_external") {
    blockers.push("UNVERIFIED_EXTERNAL");
  }
  if (candidate.authRequirement === "REQUIRED" && candidate.providerCredentialsConfigured !== true) {
    blockers.push("AUTH_REQUIRED");
  }
  if (candidate.requiredParameters.length > 0) blockers.push("REQUIRED_PARAMETERS");
  if (candidate.safeOperations.length === 0) blockers.push("NO_KNOWN_SAFE_OPERATION");
  if (candidate.preActionDecision && candidate.preActionDecision !== "ALLOW") {
    blockers.push(`PRE_ACTION_${candidate.preActionDecision}`);
  }
  if (candidate.kind !== "INTERNAL_SERVICE") blockers.push("NO_OWNER_BOUND_EXECUTION");
  if (
    candidate.kind === "INTERNAL_SERVICE" &&
    verificationPriority(candidate.verificationStatus) < 1
  ) {
    blockers.push("VERIFICATION_INSUFFICIENT");
  }
  return unique(blockers);
}

export function dedupeAgentCandidates(candidates: readonly AgentCandidateInput[]) {
  const byIdentity = new Map<string, AgentCandidateInput>();
  for (const candidate of candidates) {
    const identity = `${canonicalCandidateUrl(candidate.url)}|${candidate.name.trim().toLowerCase()}`;
    const existing = byIdentity.get(identity);
    if (!existing) {
      byIdentity.set(identity, {
        ...candidate,
        knownFacts: unique(candidate.knownFacts),
      });
      continue;
    }
    const candidatePriority =
      sourcePriority(candidate.kind) * 10 +
      verificationPriority(candidate.verificationStatus) * 5 +
      candidate.capabilityMatch +
      candidate.textMatch;
    const existingPriority =
      sourcePriority(existing.kind) * 10 +
      verificationPriority(existing.verificationStatus) * 5 +
      existing.capabilityMatch +
      existing.textMatch;
    const winner = candidatePriority > existingPriority ? candidate : existing;
    byIdentity.set(identity, {
      ...winner,
      knownFacts: unique([...existing.knownFacts, ...candidate.knownFacts]),
    });
  }
  return [...byIdentity.values()];
}

export function normalizeAgentTask(task: string): AgentIntent {
  const safeTask = task.trim().slice(0, 500);
  const normalizedTask = normalize(safeTask);
  const matches = CAPABILITY_DEFINITIONS.map((definition) => {
    const matchedTerms = definition.terms.filter((term) => normalizedTask.includes(normalize(term)));
    return { definition, matchedTerms };
  }).filter(({ matchedTerms }) => matchedTerms.length > 0);

  if (matches.length === 0) {
    return {
      task: safeTask,
      capability: "UNKNOWN",
      confidence: "UNKNOWN",
      matchedTerms: [],
      searchTerms: safeTask ? [safeTask] : [],
      parameterHints: [],
      reason: "Keine bekannte Capability wurde deterministisch erkannt; generische Suche ohne Annahmen.",
    };
  }

  const highestMatchCount = Math.max(...matches.map(({ matchedTerms }) => matchedTerms.length));
  const strongest = matches.filter(({ matchedTerms }) => matchedTerms.length === highestMatchCount);
  if (strongest.length !== 1) {
    return {
      task: safeTask,
      capability: "UNKNOWN",
      confidence: "UNKNOWN",
      matchedTerms: unique(strongest.flatMap(({ matchedTerms }) => matchedTerms)),
      searchTerms: unique([safeTask, ...strongest.flatMap(({ definition }) => definition.searchTerms)]),
      parameterHints: [],
      reason: "Mehrere bekannte Capabilities sind gleich stark; es wird keine Capability erfunden.",
    };
  }

  const { definition, matchedTerms } = strongest[0];
  return {
    task: safeTask,
    capability: definition.capability,
    confidence: matchedTerms.length > 1 ? "HIGH" : "MEDIUM",
    matchedTerms: unique(matchedTerms),
    searchTerms: unique([safeTask, ...definition.searchTerms]),
    parameterHints: [...definition.parameterHints],
    reason: `Capability ${definition.capability} wurde aus bekannten Begriffen erkannt.`,
  };
}

function candidateSort(left: AgentDecisionCandidate, right: AgentDecisionCandidate) {
  const sourceDifference = sourcePriority(right.kind) - sourcePriority(left.kind);
  if (sourceDifference !== 0) return sourceDifference;
  const verificationDifference =
    verificationPriority(right.verificationStatus) - verificationPriority(left.verificationStatus);
  if (verificationDifference !== 0) return verificationDifference;
  const scoreDifference = right.selectionScore - left.selectionScore;
  if (scoreDifference !== 0) return scoreDifference;
  const nameDifference = normalize(left.name).localeCompare(normalize(right.name));
  return nameDifference !== 0 ? nameDifference : left.id.localeCompare(right.id);
}

export function decideAgentTask(
  task: string,
  candidates: readonly AgentCandidateInput[],
): {
  contractVersion: typeof AGENT_DECISION_CONTRACT_VERSION;
  intent: AgentIntent;
  bestCandidate: AgentDecisionCandidate | null;
  candidates: AgentDecisionCandidate[];
  why: string[];
  authRequirement: AgentAuthRequirement;
  requiredParameters: string[];
  verificationStatus: string;
  canExecute: boolean;
  blockers: string[];
  nextAction: string;
  feedback?: AgentFeedback;
} {
  const intent = normalizeAgentTask(task);
  const scored = dedupeAgentCandidates(candidates)
    .filter((candidate) => candidate.name.trim() && candidate.url.trim())
    .map((candidate) => {
      const selectionScore = clampScore(
        candidate.capabilityMatch * 0.45 +
          candidate.textMatch * 0.25 +
          candidate.openApiMetadata * 0.1 +
          verificationPriority(candidate.verificationStatus) * 15 +
          Math.min(10, Math.max(0, candidate.trustScore ?? 0) / 10),
      );
      const blockers = blockersForCandidate(candidate);
      return {
        ...candidate,
        selectionScore,
        blockers,
        canExecute: blockers.length === 0,
      };
    })
    .filter((candidate) => candidate.capabilityMatch > 0 || candidate.textMatch > 0)
    .sort(candidateSort);

  const bestCandidate = scored[0] ?? null;
  const why = [
    intent.reason,
    bestCandidate
      ? `Aus ${scored.length} passenden Kandidaten wurde ${bestCandidate.name} anhand von Provenienz, Verifikation, Trust und Match-Fakten priorisiert.`
      : "Es wurde kein passender Kandidat mit belegbaren Fakten gefunden.",
  ];

  if (bestCandidate) {
    if (bestCandidate.kind === "EXTERNAL_DISCOVERY") {
      why.push("Externe Quellen bleiben UNVERIFIED_EXTERNAL und werden niemals allein durch Ranking ausführbar.");
    }
    if (bestCandidate.requiredParameters.length > 0) {
      why.push("Die erforderlichen Parameter sind bekannt, aber noch nicht vollständig vorhanden.");
    }
    if (bestCandidate.authRequirement === "REQUIRED") {
      why.push("Der Kandidat verlangt Authentifizierung; Bond402 erfindet oder sendet keine Credentials.");
    }
  }

  const blockers = bestCandidate?.blockers ?? ["NO_MATCH"];
  const canExecute = bestCandidate?.canExecute === true;
  const nextAction = !bestCandidate
    ? "Aufgabe präzisieren oder einen expliziten Dienst mit belegbarer OpenAPI-Spezifikation angeben."
    : canExecute
      ? "Vor einer Aktion weiterhin die eigene Berechtigung und die konkrete Operation prüfen."
      : bestCandidate.blockers.includes("AUTH_REQUIRED")
        ? "Owner-gebundene Authentifizierung im geschützten Developer-Flow bereitstellen; keine öffentlichen Credentials verwenden."
        : bestCandidate.blockers.includes("REQUIRED_PARAMETERS")
          ? "Nur die fehlenden Parameter explizit angeben; keine Werte oder Pfadparameter raten."
          : bestCandidate.blockers.includes("UNVERIFIED_EXTERNAL")
            ? "Externe Metadaten prüfen und den sicheren, read-only Preflight verwenden; nicht ausführen."
            : "Keine Aktion ausführen; zuerst die angezeigten Blocker beheben oder manuell klären.";

  return {
    contractVersion: AGENT_DECISION_CONTRACT_VERSION,
    intent,
    bestCandidate,
    candidates: scored.slice(0, 20),
    why,
    authRequirement: bestCandidate?.authRequirement ?? "UNKNOWN",
    requiredParameters: bestCandidate?.requiredParameters ?? [],
    verificationStatus: bestCandidate?.verificationStatus ?? "UNKNOWN",
    canExecute,
    blockers,
    nextAction,
  };
}
