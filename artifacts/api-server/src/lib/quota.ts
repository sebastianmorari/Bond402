import type { Response } from "express";
import { consumeMonthlyCheck } from "./usage";

export async function requireCheckQuota(userId: string, res: Response) {
  const result = await consumeMonthlyCheck(userId);
  if (result.allowed) return result.usage;

  res.status(429).json({
    error: `Ihr ${result.usage.planName}-Kontingent ist aufgebraucht. Wählen Sie ein größeres Paket für weitere Produktchecks.`,
    code: "QUOTA_EXCEEDED",
    quota: result.usage,
  });
  return null;
}