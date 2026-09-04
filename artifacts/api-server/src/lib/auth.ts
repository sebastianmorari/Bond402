import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq, gt, lt } from "drizzle-orm";
import { bond402SessionsTable, bond402UsersTable, db, type Bond402UserRow } from "@workspace/db";

const SESSION_COOKIE = "bond402_session";
const SESSION_DAYS = 30;
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  };
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function toAuthUser(user: Bond402UserRow) {
  return {
    id: user.id,
    email: user.email,
    name: user.displayName,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(password, salt, PASSWORD_KEY_LENGTH);
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [saltHex, keyHex] = storedHash.split(":");
  if (!saltHex || !keyHex || !/^[a-f0-9]+$/i.test(saltHex) || !/^[a-f0-9]+$/i.test(keyHex)) {
    return false;
  }
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(keyHex, "hex");
  const actual = await deriveKey(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function deriveKey(password: string, salt: Buffer, keyLength: number) {
  return new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(password, salt, keyLength, PASSWORD_SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey as Buffer);
    });
  });
}

export async function createSession(userId: string, res: Response) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(bond402SessionsTable).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt,
    lastUsedAt: new Date(),
  });
  res.cookie(SESSION_COOKIE, token, cookieOptions());
}

export async function getCurrentUser(req: Request): Promise<Bond402UserRow | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token || typeof token !== "string" || token.length < 32) return null;
  const tokenHash = hashSessionToken(token);
  const [session] = await db
    .select()
    .from(bond402SessionsTable)
    .where(and(eq(bond402SessionsTable.tokenHash, tokenHash), gt(bond402SessionsTable.expiresAt, new Date())));
  if (!session) return null;

  const [user] = await db
    .select()
    .from(bond402UsersTable)
    .where(eq(bond402UsersTable.id, session.userId));
  if (!user) return null;

  await db
    .update(bond402SessionsTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(bond402SessionsTable.id, session.id));
  return user;
}

export async function destroyCurrentSession(req: Request, res: Response) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === "string" && token.length >= 32) {
    await db
      .delete(bond402SessionsTable)
      .where(eq(bond402SessionsTable.tokenHash, hashSessionToken(token)));
  }
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
}

export async function pruneExpiredSessions() {
  await db.delete(bond402SessionsTable).where(lt(bond402SessionsTable.expiresAt, new Date()));
}

export async function requireUserId(req: Request, res: Response): Promise<string | null> {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({
      error: "Bitte melden Sie sich an, um Ihre Dienste zu verwalten.",
      code: "UNAUTHORIZED",
    });
    return null;
  }
  return user.id;
}