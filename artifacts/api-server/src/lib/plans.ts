export const PLAN_CATALOG = {
  FREE: {
    id: "FREE",
    name: "Free",
    monthlyChecks: 100,
    priceChf: 0,
    description: "Für erste Trust-Prüfungen und kleine Agenten-Workloads.",
  },
  STARTER: {
    id: "STARTER",
    name: "Starter",
    monthlyChecks: 2_500,
    priceChf: 19,
    description: "Für regelmäßige API- und Agentenprüfungen.",
  },
  PRO: {
    id: "PRO",
    name: "Pro",
    monthlyChecks: 15_000,
    priceChf: 69,
    description: "Für produktive AI-Agenten-Integrationen.",
  },
  BUSINESS: {
    id: "BUSINESS",
    name: "Business",
    monthlyChecks: 75_000,
    priceChf: 199,
    description: "Für mehrere Teams und größere Workloads.",
  },
  ENTERPRISE: {
    id: "ENTERPRISE",
    name: "Enterprise",
    monthlyChecks: null,
    priceChf: null,
    description: "Individuelle Kontingente und Vereinbarungen.",
  },
} as const;

export type PlanId = keyof typeof PLAN_CATALOG;

export function normalizePlan(value: string): PlanId {
  return value in PLAN_CATALOG ? (value as PlanId) : "FREE";
}

export function getPlan(plan: string) {
  return PLAN_CATALOG[normalizePlan(plan)];
}