import { and, eq, lt, sql } from "drizzle-orm";
import { bond402UsageTable, db } from "@workspace/db";
import { getPlan, normalizePlan, PLAN_CATALOG, type PlanId } from "./plans";

function monthStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function resetAt(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

async function ensureUsageRow(userId: string) {
  const periodStart = monthStart();
  await db
    .insert(bond402UsageTable)
    .values({ userId, plan: "FREE", usedChecks: 0, periodStart })
    .onConflictDoNothing({ target: bond402UsageTable.userId });

  const [row] = await db
    .select()
    .from(bond402UsageTable)
    .where(eq(bond402UsageTable.userId, userId));
  if (!row) throw new Error("Nutzungsprofil konnte nicht geladen werden.");

  if (row.periodStart < periodStart) {
    const [resetRow] = await db
      .update(bond402UsageTable)
      .set({ usedChecks: 0, periodStart })
      .where(
        and(
          eq(bond402UsageTable.userId, userId),
          lt(bond402UsageTable.periodStart, periodStart),
        ),
      )
      .returning();
    return resetRow ?? row;
  }
  return row;
}

export function toUsageResponse(row: { plan: string; usedChecks: number; periodStart: Date }) {
  const plan = getPlan(row.plan);
  const remainingChecks =
    plan.monthlyChecks === null ? null : Math.max(0, plan.monthlyChecks - row.usedChecks);
  return {
    plan: plan.id as PlanId,
    planName: plan.name,
    monthlyLimit: plan.monthlyChecks,
    usedChecks: row.usedChecks,
    remainingChecks,
    periodStart: row.periodStart.toISOString(),
    resetAt: resetAt(row.periodStart).toISOString(),
    upgradeAvailable: plan.id !== "ENTERPRISE",
    priceChf: plan.priceChf,
    description: plan.description,
    availablePlans: Object.values(PLAN_CATALOG).map((availablePlan) => ({
      plan: availablePlan.id,
      planName: availablePlan.name,
      monthlyLimit: availablePlan.monthlyChecks,
      priceChf: availablePlan.priceChf,
      description: availablePlan.description,
    })),
  };
}

export async function getUsage(userId: string) {
  return toUsageResponse(await ensureUsageRow(userId));
}

export async function ensureFreeUsage(userId: string) {
  await ensureUsageRow(userId);
}

export async function consumeMonthlyCheck(userId: string) {
  const current = await ensureUsageRow(userId);
  const plan = getPlan(current.plan);
  const where = [
    eq(bond402UsageTable.userId, userId),
    eq(bond402UsageTable.periodStart, current.periodStart),
  ];
  if (plan.monthlyChecks !== null) {
    where.push(lt(bond402UsageTable.usedChecks, plan.monthlyChecks));
  }

  const [updated] = await db
    .update(bond402UsageTable)
    .set({ usedChecks: sql`${bond402UsageTable.usedChecks} + 1` })
    .where(and(...where))
    .returning();

  if (!updated) {
    return { allowed: false as const, usage: toUsageResponse(current) };
  }
  return { allowed: true as const, usage: toUsageResponse(updated) };
}