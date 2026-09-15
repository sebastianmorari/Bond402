import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dedupeAgentCandidates,
  decideAgentTask,
  normalizeAgentTask,
  type AgentCandidateInput,
} from "../artifacts/api-server/src/lib/agent-decision.ts";

const safeOperation = {
  method: "GET",
  path: "/status",
  url: "https://api.example.test/status",
  reason: "EXPLICITLY_PUBLIC_PARAMETER_FREE_READ",
};

function candidate(overrides: Partial<AgentCandidateInput> = {}): AgentCandidateInput {
  return {
    id: "candidate-1",
    kind: "INTERNAL_SERVICE",
    name: "Weather API",
    description: "Public weather data",
    url: "https://api.example.test",
    source: "BOND402_INTERNAL_CATALOG",
    sourceLabel: "Internal Bond402 catalog",
    sourceUrl: "https://bond402.example/catalog",
    capabilityMatch: 90,
    textMatch: 90,
    openApiMetadata: 0,
    verificationStatus: "VERIFIED_LOW_RISK",
    trustStatus: "VERIFIED_LOW_RISK",
    trustScore: 82,
    authRequirement: "NOT_REQUIRED",
    requiredParameters: [],
    safeOperations: [safeOperation],
    preActionDecision: "ALLOW",
    knownFacts: ["LISTED_INTERNAL_SERVICE"],
    ...overrides,
  };
}

test("Natural-language intent recognition stays deterministic for all capabilities", () => {
  const cases = [
    ["Wie ist das Wetter in Berlin?", "WEATHER"],
    ["Generate an image of a lighthouse", "IMAGE_GENERATION"],
    ["Show me the football results from yesterday", "FOOTBALL_RESULTS"],
    ["Convert 100 EUR to USD", "CURRENCY_CONVERSION"],
  ] as const;

  for (const [task, capability] of cases) {
    const intent = normalizeAgentTask(task);
    assert.equal(intent.capability, capability);
    assert.ok(intent.parameterHints.length > 0);
    assert.ok(intent.searchTerms.length > 0);
  }
});

test("Unknown tasks use the conservative UNKNOWN fallback without parameter guesses", () => {
  const intent = normalizeAgentTask("Summarize the latest public transport policy");
  assert.equal(intent.capability, "UNKNOWN");
  assert.equal(intent.confidence, "UNKNOWN");
  assert.deepEqual(intent.parameterHints, []);
  assert.deepEqual(intent.matchedTerms, []);
});

test("Candidate deduplication is deterministic and prefers internal provenance", () => {
  const deduped = dedupeAgentCandidates([
    candidate({
      id: "external-copy",
      kind: "EXTERNAL_DISCOVERY",
      source: "APIS_GURU_OPENAPI_DIRECTORY",
      sourceLabel: "APIs.guru",
      sourceUrl: "https://api.apis.guru/v2/list.json",
      url: "https://api.example.test/",
      knownFacts: ["UNVERIFIED_EXTERNAL"],
    }),
    candidate({
      id: "internal-copy",
      knownFacts: ["LISTED_INTERNAL_SERVICE", "PRE_ACTION_DECISION:ALLOW"],
      url: "https://api.example.test?source=internal",
    }),
  ]);

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].id, "internal-copy");
  assert.deepEqual(deduped[0].knownFacts.sort(), [
    "LISTED_INTERNAL_SERVICE",
    "PRE_ACTION_DECISION:ALLOW",
    "UNVERIFIED_EXTERNAL",
  ]);
});

test("Missing parameters and required auth remain blockers", () => {
  const decision = decideAgentTask("weather in Berlin", [
    candidate({
      authRequirement: "REQUIRED",
      requiredParameters: ["location"],
    }),
  ]);

  assert.equal(decision.canExecute, false);
  assert.ok(decision.blockers.includes("AUTH_REQUIRED"));
  assert.ok(decision.blockers.includes("REQUIRED_PARAMETERS"));
  assert.deepEqual(decision.requiredParameters, ["location"]);
});

test("External discovery can never become executable from ranking alone", () => {
  const decision = decideAgentTask("weather", [
    candidate({
      id: "external-weather",
      kind: "EXTERNAL_DISCOVERY",
      source: "APIS_GURU_OPENAPI_DIRECTORY",
      sourceLabel: "APIs.guru",
      sourceUrl: "https://api.apis.guru/v2/list.json",
      verificationStatus: "UNVERIFIED_EXTERNAL",
      trustStatus: "UNKNOWN",
      trustScore: null,
    }),
  ]);

  assert.equal(decision.bestCandidate?.kind, "EXTERNAL_DISCOVERY");
  assert.equal(decision.canExecute, false);
  assert.ok(decision.blockers.includes("UNVERIFIED_EXTERNAL"));
  assert.ok(decision.blockers.includes("NO_OWNER_BOUND_EXECUTION"));
});

test("Decision response exposes the complete machine-readable contract", () => {
  const decision = decideAgentTask("weather", [candidate()]);
  const requiredFields = [
    "contractVersion",
    "intent",
    "bestCandidate",
    "candidates",
    "why",
    "authRequirement",
    "requiredParameters",
    "verificationStatus",
    "canExecute",
    "blockers",
    "nextAction",
  ];

  for (const field of requiredFields) {
    assert.ok(field in decision, `missing decision field ${field}`);
  }
  assert.equal(decision.intent.capability, "WEATHER");
  assert.equal(decision.bestCandidate?.source, "BOND402_INTERNAL_CATALOG");
  assert.equal(decision.bestCandidate?.canExecute, true);
  assert.deepEqual(decision.requiredParameters, []);
});