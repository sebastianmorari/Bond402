import { Router, type IRouter, type Response } from "express";
import { eq } from "drizzle-orm";
import { bond402UsersTable, db } from "@workspace/db";
import {
  AuthLoginBody,
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

function allowLoginAttempt(ip: string) {
  const now = Date.now();
  const current = failedAttempts.get(ip);
  if (!current || current.resetAt <= now) {
    failedAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (current.count >= 10) return false;
  current.count += 1;
  return true;
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
  await pruneExpiredSessions();

  const existing = await db
    .select({ id: bond402UsersTable.id })
    .from(bond402UsersTable)
    .where(eq(bond402UsersTable.email, email));
  if (existing.length > 0) {
    res.status(409).json({ error: "Für diese E-Mail-Adresse existiert bereits ein Konto.", code: "EMAIL_EXISTS" });
    return;
  }

  const [user] = await db
    .insert(bond402UsersTable)
    .values({
      id: crypto.randomUUID(),
      email,
      displayName,
      passwordHash: await hashPassword(parsed.data.password),
    })
    .returning();
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
  if (!allowLoginAttempt(ip)) {
    res.set("Retry-After", "60");
    res.status(429).json({ error: "Zu viele Anmeldeversuche. Bitte warten Sie kurz.", code: "RATE_LIMITED" });
    return;
  }
  const [user] = await db
    .select()
    .from(bond402UsersTable)
    .where(eq(bond402UsersTable.email, normalizeEmail(parsed.data.email)));
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    authError(res);
    return;
  }
  await createSession(user.id, res);
  res.json(LoginAuthUserResponse.parse({ user: toAuthUser(user) }));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await destroyCurrentSession(req, res);
  res.sendStatus(204);
});

export default router;