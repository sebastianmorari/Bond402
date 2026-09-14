import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { apiKeysTable, apiRateLimitsTable, db } from "@workspace/db";
import {
  CreateApiKeyBody,
  CreateApiKeyResponse,
  ListApiKeysResponse,
  RevokeApiKeyParams,
} from "@workspace/api-zod";
import { consumeOwnerRateLimit, hashApiKey } from "../lib/api-key-auth";
import { requireUserId } from "../lib/auth";
import { createAgentFeedback, feedbackForHttpError } from "../lib/agent-feedback";

const router: IRouter = Router();
const MAX_ACTIVE_KEYS = 10;
const MAX_REVOKED_KEYS = 20;

function toResponse(key: typeof apiKeysTable.$inferSelect) {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    createdAt: key.createdAt.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
  };
}

async function requireKeyManagementCapacity(ownerId: string, res: Response) {
  const rate = await consumeOwnerRateLimit(ownerId, "key-management", 20);
  if (!rate.allowed) {
    res.set("Retry-After", String(rate.retryAfter));
    res.status(429).json({
      error: "Zu viele Änderungen an API-Schlüsseln. Bitte warten Sie kurz.",
      code: "RATE_LIMITED",
      feedback: feedbackForHttpError(
        429,
        "RATE_LIMITED",
        "Das API-Key-Management-Limit wurde erreicht.",
        { retryAfterSeconds: rate.retryAfter, nextAction: "Retry-After beachten und später erneut versuchen." },
      ),
    });
    return false;
  }
  return true;
}

async function pruneRevokedKeys(ownerId: string) {
  const expired = await db
    .select({ id: apiKeysTable.id })
    .from(apiKeysTable)
    .where(and(eq(apiKeysTable.ownerId, ownerId), sql`${apiKeysTable.revokedAt} IS NOT NULL`))
    .orderBy(desc(apiKeysTable.revokedAt))
    .limit(500)
    .offset(MAX_REVOKED_KEYS);
  if (expired.length === 0) return;
  const ids = expired.map((key) => key.id);
  await db.delete(apiKeysTable).where(inArray(apiKeysTable.id, ids));
  await db
    .delete(apiRateLimitsTable)
    .where(inArray(apiRateLimitsTable.identity, ids.map((id) => `key:${id}`)));
}

router.get("/api-keys", async (req, res): Promise<void> => {
  const ownerId = await requireUserId(req, res);
  if (!ownerId) return;
  const keys = await db
    .select()
    .from(apiKeysTable)
    .where(eq(apiKeysTable.ownerId, ownerId))
    .orderBy(desc(apiKeysTable.createdAt))
    .limit(MAX_ACTIVE_KEYS + MAX_REVOKED_KEYS);
  res.json(ListApiKeysResponse.parse(keys.map(toResponse)));
});

router.post("/api-keys", async (req, res): Promise<void> => {
  const ownerId = await requireUserId(req, res);
  if (!ownerId) return;
  if (!(await requireKeyManagementCapacity(ownerId, res))) return;
  const body = CreateApiKeyBody.safeParse(req.body);
  const name = body.success ? body.data.name.trim() : "";
  if (!body.success || name.length < 2) {
    res.status(400).json({
      error: "Bitte geben Sie einen Namen mit mindestens zwei Zeichen ein.",
      code: "INVALID_INPUT",
      feedback: feedbackForHttpError(
        400,
        "INVALID_INPUT",
        "Der API-Key-Name ist ungültig.",
        { nextAction: "Einen Namen mit mindestens zwei Zeichen senden." },
      ),
    });
    return;
  }

  const secret = `b402_${randomBytes(32).toString("base64url")}`;
  await pruneRevokedKeys(ownerId);
  const key = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))`);
    const activeKeys = await tx
      .select({ id: apiKeysTable.id })
      .from(apiKeysTable)
      .where(and(eq(apiKeysTable.ownerId, ownerId), isNull(apiKeysTable.revokedAt)));
    if (activeKeys.length >= MAX_ACTIVE_KEYS) return null;
    const [created] = await tx
      .insert(apiKeysTable)
      .values({
        id: crypto.randomUUID(),
        ownerId,
        name,
        keyHash: hashApiKey(secret),
        prefix: `${secret.slice(0, 13)}…`,
      })
      .returning();
    return created;
  });
  if (!key) {
    res.status(400).json({
      error: "Sie können höchstens 10 aktive API-Schlüssel verwenden.",
      code: "KEY_LIMIT_REACHED",
      feedback: feedbackForHttpError(
        400,
        "KEY_LIMIT_REACHED",
        "Die maximale Zahl aktiver API-Schlüssel ist erreicht.",
        { nextAction: "Einen bestehenden Schlüssel widerrufen oder einen vorhandenen verwenden." },
      ),
    });
    return;
  }
  const response = CreateApiKeyResponse.parse({ ...toResponse(key), secret });
  res.status(201).json({
    ...response,
    feedback: createAgentFeedback({
      status: "READY",
      code: "DEVELOPER_KEY_CREATED",
      summary: "Der owner-gebundene Developer-API-Key wurde erstellt.",
      nextAction: "Das Secret jetzt sicher speichern; es wird nur einmal angezeigt und darf nicht geloggt werden.",
      requiredAuth: true,
      source: "BOND402_OWNER_CATALOG",
    }),
  });
});

router.delete("/api-keys/:id", async (req, res): Promise<void> => {
  const ownerId = await requireUserId(req, res);
  if (!ownerId) return;
  if (!(await requireKeyManagementCapacity(ownerId, res))) return;
  const params = RevokeApiKeyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({
      error: "Ungültige Schlüssel-ID.",
      code: "INVALID_ID",
      feedback: feedbackForHttpError(400, "INVALID_ID", "Die API-Key-ID ist ungültig."),
    });
    return;
  }
  const [revoked] = await db
    .update(apiKeysTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeysTable.id, params.data.id),
        eq(apiKeysTable.ownerId, ownerId),
        isNull(apiKeysTable.revokedAt),
      ),
    )
    .returning({ id: apiKeysTable.id });
  if (!revoked) {
    res.status(404).json({
      error: "API-Schlüssel nicht gefunden.",
      code: "NOT_FOUND",
      feedback: feedbackForHttpError(404, "NOT_FOUND", "Der API-Key gehört nicht zum aktuellen Owner oder existiert nicht."),
    });
    return;
  }
  await pruneRevokedKeys(ownerId);
  res.sendStatus(204);
});

export default router;