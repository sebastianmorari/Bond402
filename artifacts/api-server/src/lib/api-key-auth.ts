import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { apiKeysTable, apiRateLimitsTable, db } from "@workspace/db";
import { createAgentFeedback } from "./agent-feedback";

type RateBucket = { count: number; resetAt: number };
const invalidKeyBuckets = new Map<string, RateBucket>();
const lookupBuckets = new Map<string, RateBucket>();

function authFeedback(status: "AUTH_REQUIRED" | "RATE_LIMITED", code: string, retryAfterSeconds: number | null = null) {
  return createAgentFeedback({
    status,
    code,
    summary:
      status === "AUTH_REQUIRED"
        ? "Für diesen Developer-Flow ist ein gültiger owner-gebundener API-Schlüssel erforderlich."
        : "Das Developer-API-Limit wurde erreicht.",
    nextAction:
      status === "AUTH_REQUIRED"
        ? "Einen gültigen API-Schlüssel im Authorization-Header verwenden; keine Secrets in Feedback oder Logs senden."
        : "Retry-After beachten und später erneut versuchen.",
    httpStatus: status === "AUTH_REQUIRED" ? 401 : 429,
    retryAfterSeconds,
    requiredAuth: true,
  });
}

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function allowInvalidKeyAttempt(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const bucket = invalidKeyBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    invalidKeyBuckets.set(ip, { count: 1, resetAt: now + windowMs });
    if (invalidKeyBuckets.size > 5_000) {
      for (const [key, value] of invalidKeyBuckets) {
        if (value.resetAt <= now) invalidKeyBuckets.delete(key);
      }
      while (invalidKeyBuckets.size > 10_000) {
        const first = invalidKeyBuckets.keys().next().value;
        if (!first) break;
        invalidKeyBuckets.delete(first);
      }
    }
    return true;
  }
  if (bucket.count >= 20) return false;
  bucket.count += 1;
  return true;
}

function allowLookupAttempt(ip: string): boolean {
  const now = Date.now();
  const bucket = lookupBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    lookupBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    if (lookupBuckets.size > 5_000) {
      for (const [key, value] of lookupBuckets) {
        if (value.resetAt <= now) lookupBuckets.delete(key);
      }
      while (lookupBuckets.size > 10_000) {
        const first = lookupBuckets.keys().next().value;
        if (!first) break;
        lookupBuckets.delete(first);
      }
    }
    return true;
  }
  if (bucket.count >= 300) return false;
  bucket.count += 1;
  return true;
}

async function consumeRateLimit(
  identity: string,
  scope: string,
  limit: number,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / 60_000) * 60_000);
  const [bucket] = await db
    .insert(apiRateLimitsTable)
    .values({ identity, scope, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [apiRateLimitsTable.identity, apiRateLimitsTable.scope],
      set: {
        windowStart: sql`CASE WHEN ${apiRateLimitsTable.windowStart} < excluded.window_start THEN excluded.window_start ELSE ${apiRateLimitsTable.windowStart} END`,
        count: sql`CASE WHEN ${apiRateLimitsTable.windowStart} < excluded.window_start THEN 1 ELSE ${apiRateLimitsTable.count} + 1 END`,
      },
    })
    .returning();
  return {
    allowed: bucket.count <= limit,
    retryAfter: Math.max(1, Math.ceil((windowStart.getTime() + 60_000 - now) / 1000)),
  };
}

export async function consumeOwnerRateLimit(
  ownerId: string,
  scope: string,
  limit: number,
): Promise<{ allowed: boolean; retryAfter: number }> {
  return consumeRateLimit(`owner:${ownerId}`, scope, limit);
}

export async function consumePublicRateLimit(
  ip: string,
  scope: string,
  limit: number,
): Promise<{ allowed: boolean; retryAfter: number }> {
  return consumeRateLimit(`public:${ip}`, scope, limit);
}

export async function authenticateApiKey(
  req: Request,
  res: Response,
  scope: "read" | "check",
): Promise<{ ownerId: string; keyId: string } | null> {
  const authorization = req.get("authorization") ?? "";
  const sourceIp = req.ip ?? "unknown";
  if (!allowLookupAttempt(sourceIp)) {
    res.set("Retry-After", "60");
    res.status(429).json({
      error: "Zu viele API-Anfragen. Bitte warten Sie kurz.",
      code: "RATE_LIMITED",
      feedback: authFeedback("RATE_LIMITED", "RATE_LIMITED", 60),
    });
    return null;
  }
  const match = authorization.match(/^Bearer\s+(b402_[A-Za-z0-9_-]{40,})$/);
  if (!match) {
    if (!allowInvalidKeyAttempt(sourceIp)) {
      res.set("Retry-After", "60");
      res.status(429).json({
        error: "Zu viele ungültige Anmeldeversuche. Bitte warten Sie kurz.",
        code: "RATE_LIMITED",
        feedback: authFeedback("RATE_LIMITED", "RATE_LIMITED", 60),
      });
      return null;
    }
    res.status(401).json({
      error: "API-Schlüssel fehlt oder ist ungültig.",
      code: "INVALID_API_KEY",
      feedback: authFeedback("AUTH_REQUIRED", "INVALID_API_KEY"),
    });
    return null;
  }

  const [key] = await db
    .select()
    .from(apiKeysTable)
    .where(
      and(
        eq(apiKeysTable.keyHash, hashApiKey(match[1])),
        isNull(apiKeysTable.revokedAt),
      ),
    );
  if (!key) {
    if (!allowInvalidKeyAttempt(sourceIp)) {
      res.set("Retry-After", "60");
      res.status(429).json({
        error: "Zu viele ungültige Anmeldeversuche. Bitte warten Sie kurz.",
        code: "RATE_LIMITED",
        feedback: authFeedback("RATE_LIMITED", "RATE_LIMITED", 60),
      });
      return null;
    }
    res.status(401).json({
      error: "API-Schlüssel fehlt oder ist ungültig.",
      code: "INVALID_API_KEY",
      feedback: authFeedback("AUTH_REQUIRED", "INVALID_API_KEY"),
    });
    return null;
  }

  const keyLimit = scope === "check" ? 10 : 60;
  const ownerLimit = scope === "check" ? 20 : 120;
  const [keyRate, ownerRate] = await Promise.all([
    consumeRateLimit(`key:${key.id}`, scope, keyLimit),
    consumeRateLimit(`owner:${key.ownerId}`, scope, ownerLimit),
  ]);
  if (!keyRate.allowed || !ownerRate.allowed) {
    res.set("Retry-After", String(Math.max(keyRate.retryAfter, ownerRate.retryAfter)));
    res.status(429).json({
      error: "Zu viele Anfragen. Bitte warten Sie kurz und versuchen Sie es erneut.",
      code: "RATE_LIMITED",
      feedback: authFeedback("RATE_LIMITED", "RATE_LIMITED", Math.max(keyRate.retryAfter, ownerRate.retryAfter)),
    });
    return null;
  }

  await db
    .update(apiKeysTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeysTable.id, key.id));
  return { ownerId: key.ownerId, keyId: key.id };
}