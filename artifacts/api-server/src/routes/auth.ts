import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { bond402AuthTokensTable, bond402SessionsTable, bond402UsageTable, bond402UsersTable, db } from "@workspace/db";
import {
  ChangeAuthPasswordBody,
  LoginAuthUserBody,
  LoginAuthUserResponse,
  GetAuthMeResponse,
  RegisterAuthUserBody,
  RegisterAuthUserResponse,
  ResendAuthVerificationBody,
  ResendAuthVerificationResponse,
  RequestAuthPasswordResetBody,
  RequestAuthPasswordResetResponse,
  ResetAuthPasswordBody,
  VerifyAuthEmailBody,
  VerifyAuthEmailResponse,
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
import { ensureFreeUsage } from "../lib/usage";
import {
  AUTH_TOKEN_PURPOSE,
  EMAIL_VERIFICATION_TTL_MS,
  EmailDeliveryError,
  PASSWORD_RESET_TTL_MS,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "../lib/auth-mail";
import { consumeAuthToken, issueAuthToken } from "../lib/auth-tokens";
import { logger } from "../lib/logger";
import { publicBaseUrl } from "../lib/public-sitemap";
import { createAgentFeedback, feedbackForHttpError } from "../lib/agent-feedback";

const router: IRouter = Router();
const failedAttempts = new Map<string, { count: number; resetAt: number }>();
const registrationAttempts = new Map<string, { count: number; resetAt: number }>();
const passwordChangeAttempts = new Map<string, { count: number; resetAt: number }>();
const emailRequestAttempts = new Map<string, { count: number; resetAt: number }>();
const emailIpAttempts = new Map<string, { count: number; resetAt: number }>();

function allowBucketAttempt(
  buckets: Map<string, { count: number; resetAt: number }>,
  ip: string,
  limit: number,
  windowMs: number,
) {
  const now = Date.now();
  if (buckets.size > 5_000) {
    for (const [key, value] of buckets) {
      if (value.resetAt <= now) buckets.delete(key);
    }
  }
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

function isEmailVerified(user: { emailVerificationRequired: boolean; emailVerifiedAt: Date | null }) {
  return !user.emailVerificationRequired || Boolean(user.emailVerifiedAt);
}

function genericEmailMessage() {
  return "Wenn ein passendes Konto existiert, wurde eine E-Mail mit weiteren Schritten versendet.";
}

function allowEmailRequest(ip: string, email: string) {
  return (
    allowBucketAttempt(emailRequestAttempts, `${ip}:${email}`, 3, 60 * 60_000) &&
    allowBucketAttempt(emailIpAttempts, ip, 12, 60 * 60_000)
  );
}

function developmentMailOptions(req: Request) {
  if (process.env.NODE_ENV === "production" || process.env.PUBLIC_BASE_URL?.trim()) {
    return {};
  }
  return { fallbackBaseUrl: publicBaseUrl(req) };
}

function authError(res: Response) {
  res.status(401).json({
    error: "E-Mail oder Passwort ist nicht korrekt.",
    code: "INVALID_CREDENTIALS",
    feedback: feedbackForHttpError(
      401,
      "INVALID_CREDENTIALS",
      "Die Anmeldedaten sind ungültig.",
      { nextAction: "E-Mail und Passwort prüfen; Zugangsdaten niemals in Feedback oder Logs senden." },
    ),
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
  const ip = req.ip || "unknown";
  if (!allowBucketAttempt(registrationAttempts, ip, 5, 15 * 60_000)) {
    res.set("Retry-After", "900");
    res.status(429).json({
      error: "Zu viele Registrierungsversuche. Bitte später erneut versuchen.",
      code: "RATE_LIMITED",
      feedback: feedbackForHttpError(
        429,
        "RATE_LIMITED",
        "Das Owner-Onboarding-Limit wurde erreicht.",
        { retryAfterSeconds: 900 },
      ),
    });
    return;
  }
  const parsed = RegisterAuthUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Bitte prüfen Sie Name, E-Mail und Passwort.",
      code: "INVALID_INPUT",
      feedback: feedbackForHttpError(
        400,
        "INVALID_INPUT",
        "Die Registrierungsdaten sind unvollständig oder ungültig.",
        { nextAction: "Name, E-Mail und Passwort gemäß OpenAPI-Schema senden." },
      ),
    });
    return;
  }
  const email = normalizeEmail(parsed.data.email);
  const displayName = parsed.data.name.trim();
  if (!displayName) {
    res.status(400).json({
      error: "Bitte geben Sie einen Namen ein.",
      code: "INVALID_INPUT",
      feedback: feedbackForHttpError(400, "INVALID_INPUT", "Der Owner-Name fehlt."),
    });
    return;
  }
  await pruneExpiredSessions();

  const existing = await db
    .select({ id: bond402UsersTable.id })
    .from(bond402UsersTable)
    .where(eq(bond402UsersTable.email, email));
  if (existing.length > 0) {
    res.status(409).json({
      error: "Für diese E-Mail-Adresse existiert bereits ein Konto.",
      code: "EMAIL_EXISTS",
      feedback: feedbackForHttpError(
        409,
        "EMAIL_EXISTS",
        "Für diese E-Mail-Adresse existiert bereits ein Owner-Konto.",
        { nextAction: "Anmelden oder eine andere E-Mail-Adresse verwenden." },
      ),
    });
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
        emailVerificationRequired: true,
      })
      .returning();
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      res.status(409).json({ error: "Für diese E-Mail-Adresse existiert bereits ein Konto.", code: "EMAIL_EXISTS" });
      return;
    }
    throw error;
  }
  await ensureFreeUsage(user.id);
  const { rawToken } = await issueAuthToken(user.id, AUTH_TOKEN_PURPOSE.EMAIL_VERIFICATION, EMAIL_VERIFICATION_TTL_MS);
  try {
    await sendVerificationEmail(user.email, user.displayName, rawToken, developmentMailOptions(req));
  } catch (error) {
    await db.delete(bond402AuthTokensTable).where(eq(bond402AuthTokensTable.userId, user.id));
    await db.delete(bond402UsageTable).where(eq(bond402UsageTable.userId, user.id));
    await db.delete(bond402UsersTable).where(eq(bond402UsersTable.id, user.id));
    logger.warn({ errorType: error instanceof Error ? error.name : typeof error }, "Registrierungs-E-Mail konnte nicht versendet werden");
    if (error instanceof EmailDeliveryError) {
      res.status(503).json({
        error: "Die Registrierung konnte nicht abgeschlossen werden, weil die Bestätigungs-E-Mail nicht versendet werden konnte. Bitte später erneut versuchen.",
        code: "EMAIL_DELIVERY_FAILED",
        feedback: feedbackForHttpError(
          503,
          "EMAIL_DELIVERY_FAILED",
          "Die Owner-Registrierung wartet auf eine erfolgreich versendete Bestätigungs-E-Mail.",
          { nextAction: "Später erneut versuchen; keine Token aus Logs oder Responses übernehmen." },
        ),
      });
      return;
    }
    throw error;
  }
  const response = RegisterAuthUserResponse.parse({
    user: toAuthUser(user),
    message: "Konto erstellt. Bitte bestätigen Sie Ihre E-Mail-Adresse über den Link in Ihrem Postfach.",
    verificationRequired: true,
  });
  res.status(201).json({
    ...response,
    feedback: createAgentFeedback({
      status: "READY",
      code: "OWNER_REGISTRATION_CREATED",
      summary: "Das Owner-Konto wurde erstellt und wartet auf die E-Mail-Bestätigung.",
      nextAction: "Den Bestätigungslink aus dem E-Mail-Postfach verwenden; erst danach anmelden.",
      verification: "EMAIL_VERIFICATION_REQUIRED",
    }),
  });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const ip = req.ip || "unknown";
  if (!allowBucketAttempt(failedAttempts, ip, 10, 60_000)) {
    res.set("Retry-After", "60");
    res.status(429).json({
      error: "Zu viele Anmeldeversuche. Bitte warten Sie kurz.",
      code: "RATE_LIMITED",
      feedback: feedbackForHttpError(429, "RATE_LIMITED", "Das Login-Limit wurde erreicht.", {
        retryAfterSeconds: 60,
      }),
    });
    return;
  }
  const parsed = LoginAuthUserBody.safeParse(req.body);
  if (!parsed.success) {
    authError(res);
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
  if (!isEmailVerified(user)) {
    res.status(403).json({
      error: "Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse. Fordern Sie bei Bedarf einen neuen Bestätigungslink an.",
      code: "EMAIL_NOT_VERIFIED",
      feedback: createAgentFeedback({
        status: "AUTH_REQUIRED",
        code: "EMAIL_NOT_VERIFIED",
        summary: "Das Owner-Konto ist noch nicht für die Session-Anmeldung bestätigt.",
        nextAction: "E-Mail bestätigen und danach erneut anmelden.",
        verification: "EMAIL_VERIFICATION_REQUIRED",
        httpStatus: 403,
        requiredAuth: true,
      }),
    });
    return;
  }
  clearBucketAttempt(failedAttempts, ip);
  await createSession(user.id, res);
  const response = LoginAuthUserResponse.parse({ user: toAuthUser(user) });
  res.json({
    ...response,
    feedback: createAgentFeedback({
      status: "READY",
      code: "OWNER_SESSION_READY",
      summary: "Die Owner-Session wurde erfolgreich eingerichtet.",
      nextAction: "Das Session-Cookie für Service-Registrierung und API-Key-Erzeugung mitsenden.",
      requiredAuth: true,
    }),
  });
});

router.post("/auth/verify-email", async (req, res): Promise<void> => {
  const parsed = VerifyAuthEmailBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Der Bestätigungslink ist ungültig.",
      code: "INVALID_TOKEN",
      feedback: feedbackForHttpError(
        400,
        "INVALID_TOKEN",
        "Der E-Mail-Bestätigungstoken ist ungültig.",
        { nextAction: "Einen gültigen, einmaligen Token aus der E-Mail verwenden." },
      ),
    });
    return;
  }
  const token = await consumeAuthToken(parsed.data.token, AUTH_TOKEN_PURPOSE.EMAIL_VERIFICATION);
  if (!token) {
    res.status(400).json({
      error: "Dieser Bestätigungslink ist ungültig, abgelaufen oder wurde bereits verwendet.",
      code: "INVALID_TOKEN",
      feedback: feedbackForHttpError(
        400,
        "INVALID_TOKEN",
        "Der E-Mail-Bestätigungstoken ist ungültig, abgelaufen oder wurde bereits verwendet.",
        { nextAction: "Neuen Bestätigungstoken anfordern; Tokens nicht wiederverwenden." },
      ),
    });
    return;
  }
  await db
    .update(bond402UsersTable)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(bond402UsersTable.id, token.userId));
  const response = VerifyAuthEmailResponse.parse({
    message: "Ihre E-Mail-Adresse wurde bestätigt. Sie können sich jetzt anmelden.",
  });
  res.json({
    ...response,
    feedback: createAgentFeedback({
      status: "READY",
      code: "OWNER_EMAIL_VERIFIED",
      summary: "Die Owner-E-Mail-Adresse wurde bestätigt.",
      nextAction: "Mit dem bestätigten Konto anmelden und danach den Service registrieren.",
      verification: "EMAIL_VERIFIED",
    }),
  });
});

router.post("/auth/resend-verification", async (req, res): Promise<void> => {
  const parsed = ResendAuthVerificationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Bitte geben Sie eine gültige E-Mail-Adresse ein.", code: "INVALID_INPUT" });
    return;
  }
  const email = normalizeEmail(parsed.data.email);
  const ip = req.ip || "unknown";
  if (!allowEmailRequest(ip, email)) {
    res.set("Retry-After", "3600");
    res.status(429).json({ error: "Zu viele E-Mail-Anfragen. Bitte später erneut versuchen.", code: "RATE_LIMITED" });
    return;
  }
  const [user] = await db.select().from(bond402UsersTable).where(eq(bond402UsersTable.email, email));
  if (user && !isEmailVerified(user)) {
    const { rawToken } = await issueAuthToken(user.id, AUTH_TOKEN_PURPOSE.EMAIL_VERIFICATION, EMAIL_VERIFICATION_TTL_MS);
    try {
        await sendVerificationEmail(user.email, user.displayName, rawToken, developmentMailOptions(req));
    } catch (error) {
      // Keep the response generic so account existence is never disclosed.
      logger.warn({ errorType: error instanceof Error ? error.name : typeof error }, "Bestätigungs-E-Mail konnte nicht versendet werden");
    }
  }
  res.status(202).json(ResendAuthVerificationResponse.parse({ message: genericEmailMessage() }));
});

router.post("/auth/password/forgot", async (req, res): Promise<void> => {
  const parsed = RequestAuthPasswordResetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Bitte geben Sie eine gültige E-Mail-Adresse ein.", code: "INVALID_INPUT" });
    return;
  }
  const email = normalizeEmail(parsed.data.email);
  const ip = req.ip || "unknown";
  if (!allowEmailRequest(ip, email)) {
    res.set("Retry-After", "3600");
    res.status(429).json({ error: "Zu viele E-Mail-Anfragen. Bitte später erneut versuchen.", code: "RATE_LIMITED" });
    return;
  }
  const [user] = await db.select().from(bond402UsersTable).where(eq(bond402UsersTable.email, email));
  if (user) {
    const { rawToken } = await issueAuthToken(user.id, AUTH_TOKEN_PURPOSE.PASSWORD_RESET, PASSWORD_RESET_TTL_MS);
    try {
        await sendPasswordResetEmail(user.email, user.displayName, rawToken, developmentMailOptions(req));
    } catch (error) {
      // Keep the response generic so account existence is never disclosed.
      logger.warn({ errorType: error instanceof Error ? error.name : typeof error }, "Passwort-Reset-E-Mail konnte nicht versendet werden");
    }
  }
  res.status(202).json(RequestAuthPasswordResetResponse.parse({ message: genericEmailMessage() }));
});

router.post("/auth/password/reset", async (req, res): Promise<void> => {
  const parsed = ResetAuthPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Der Reset-Link ist ungültig oder das neue Passwort erfüllt die Anforderungen nicht.",
      code: "INVALID_INPUT",
    });
    return;
  }
  const token = await consumeAuthToken(parsed.data.token, AUTH_TOKEN_PURPOSE.PASSWORD_RESET);
  if (!token) {
    res.status(400).json({
      error: "Dieser Reset-Link ist ungültig, abgelaufen oder wurde bereits verwendet.",
      code: "INVALID_TOKEN",
    });
    return;
  }
  const passwordHash = await hashPassword(parsed.data.newPassword);
  await db.update(bond402UsersTable).set({ passwordHash }).where(eq(bond402UsersTable.id, token.userId));
  await db.delete(bond402SessionsTable).where(eq(bond402SessionsTable.userId, token.userId));
  res.sendStatus(204);
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await destroyCurrentSession(req, res);
  res.sendStatus(204);
});

router.put("/auth/password", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Nicht angemeldet.", code: "UNAUTHORIZED" });
    return;
  }

  const attemptKey = `${user.id}:${req.ip || "unknown"}`;
  if (!allowBucketAttempt(passwordChangeAttempts, attemptKey, 5, 15 * 60_000)) {
    res.set("Retry-After", "900");
    res.status(429).json({
      error: "Zu viele Passwortänderungen. Bitte später erneut versuchen.",
      code: "RATE_LIMITED",
    });
    return;
  }

  const parsed = ChangeAuthPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Bitte verwenden Sie ein Passwort mit 8 bis 128 Zeichen.",
      code: "INVALID_INPUT",
    });
    return;
  }

  const { currentPassword, newPassword } = parsed.data;
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    res.status(401).json({
      error: "Das aktuelle Passwort ist nicht korrekt.",
      code: "INVALID_CREDENTIALS",
    });
    return;
  }
  if (currentPassword === newPassword) {
    res.status(400).json({
      error: "Das neue Passwort muss sich vom bisherigen unterscheiden.",
      code: "INVALID_INPUT",
    });
    return;
  }

  const passwordHash = await hashPassword(newPassword);
  await db
    .update(bond402UsersTable)
    .set({ passwordHash })
    .where(eq(bond402UsersTable.id, user.id));
  // Revoke all existing sessions so a changed password invalidates other devices too.
  await db
    .delete(bond402SessionsTable)
    .where(eq(bond402SessionsTable.userId, user.id));
  clearBucketAttempt(passwordChangeAttempts, attemptKey);
  await createSession(user.id, res);
  res.sendStatus(204);
});

export default router;