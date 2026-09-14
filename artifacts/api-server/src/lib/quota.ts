import type { Response } from "express";
import { consumeMonthlyCheck } from "./usage";
import { createAgentFeedback } from "./agent-feedback";

export async function requireCheckQuota(userId: string, res: Response) {
  const result = await consumeMonthlyCheck(userId);
  if (result.allowed) return result.usage;

  res.status(429).json({
    error: `Ihr ${result.usage.planName}-Kontingent ist aufgebraucht. Wählen Sie ein größeres Paket für weitere Produktchecks.`,
    code: "QUOTA_EXCEEDED",
    quota: result.usage,
    feedback: createAgentFeedback({
      status: "PAYMENT_REQUIRED",
      code: "QUOTA_EXCEEDED",
      summary: "Das monatliche Kontingent für produktive Bond402-Checks ist aufgebraucht.",
      nextAction: "Kontingent prüfen oder einen passenden Plan wählen; keine erneute Anfrage-Schleife starten.",
      httpStatus: 429,
      requiredAuth: true,
    }),
  });
  return null;
}