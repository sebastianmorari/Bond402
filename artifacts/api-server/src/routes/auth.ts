import { Router, type IRouter, type Response } from "express";
import { eq } from "drizzle-orm";
import { bond402UsersTable, db } from "@workspace/db";
import {
  LoginAuthUserBody,
  LoginAuthUserResponse,
  GetAuthMeResponse,
  RegisterAuthUserBody,
  RegisterAuthUserResponse,
} from "@workspace/api-zod";
import {
  createSession,
  destroyCurrentSession,
  getCurrentUser,
  hashPassword,
  pruneExpiredSessions,
  toAuthUser,
  verifyPassword,
} from "../lib/auth";

const router: IRouter = Router();
const failedAttempts = new Map<string, { count: number; resetAt: number }>();
const registrationAttempts = new Map<string, { count: number; resetAt: number }>();

function allowBucketAttempt(
  buckets: Map<string, { count: number; resetAt: number }>,
  ip: string,
  limit: number,
  windowMs: number,
) {
  const now = Date.now();
  const current = buckets.get(ip);
  if (!current || current.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

function clearBucketAttempt(buckets: Map<string, { count: number; resetAt: number }>, ip: string) {
  buckets.delete(ip);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function authError(res: Response) {
  res.status(401).json({
    error: "E-Mail oder Passwort ist nicht korrekt.",
    code: "INVALID_CREDENTIALS",
  });
}

router.get("/auth/me", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Nicht angemeldet.", code: "UNAUTHORIZED" });
    return;
  }
  res.json(GetAuthMeResponse.parse({ user: toAuthUser(user) }));
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterAuthUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Bitte prüfen Sie Name, E-Mail und Passwort.", code: "INVALID_INPUT" });
    return;
  }
  const email = normalizeEmail(parsed.data.email);
  const displayName = parsed.data.name.trim();
  const ip = req.ip || "unknown";
  if (!displayName) {
    res.status(400).json({ error: "Bitte geben Sie einen Namen ein.", code: "INVALID_INPUT" });
    return;
  }
  if (!allowBucketAttempt(registrationAttempts, ip, 5, 15 * 60_000)) {
    res.set("Retry-After", "900");
    res.status(429).json({ error: "Zu viele Registrierungsversuche. Bitte später erneut versuchen.", code: "RATE_LIMITED" });
    return;
  }
  await pruneExpiredSessions();

  const existing = await db
    .select({ id: bond402UsersTable.id })
    .from(bond402UsersTable)
    .where(eq(bond402UsersTable.email, email));
  if (existing.length > 0) {
    res.status(409).json({ error: "Für diese E-Mail-Adresse existiert bereits ein Konto.", code: "EMAIL_EXISTS" });
    return;
  }

  let user;
  try {
    [user] = await db
      .insert(bond402UsersTable)
      .values({
        id: crypto.randomUUID(),
        email,
        displayName,
        passwordHash: await hashPassword(parsed.data.password),
      })
      .returning();
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      res.status(409).json({ error: "Für diese E-Mail-Adresse existiert bereits ein Konto.", code: "EMAIL_EXISTS" });
      return;
    }
    throw error;
  }
  await createSession(user.id, res);
  res.status(201).json(RegisterAuthUserResponse.parse({ user: toAuthUser(user) }));
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginAuthUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(401).json({ error: "E-Mail oder Passwort ist nicht korrekt.", code: "INVALID_CREDENTIALS" });
    return;
  }
  const ip = req.ip || "unknown";
  if (!allowBucketAttempt(failedAttempts, ip, 10, 60_000)) {
    res.set("Retry-After", "60");
    res.status(429).json({ error: "Zu viele Anmeldeversuche. Bitte warten Sie kurz.", code: "RATE_LIMITED" });
    return;
  }
  const [user] = await db
    .select()
    .from(bond402UsersTable)
    .where(eq(bond402UsersTable.email, normalizeEmail(parsed.data.email)));
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    if (failedAttempts.size > 5000) {
      for (const [key, value] of failedAttempts) {
        if (value.resetAt <= Date.now()) failedAttempts.delete(key);
      }
    }
    authError(res);
    return;
  }
  clearBucketAttempt(failedAttempts, ip);
  await createSession(user.id, res);
  res.json(LoginAuthUserResponse.parse({ user: toAuthUser(user) }));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await destroyCurrentSession(req, res);
  res.sendStatus(204);
});

export default router;