import { and, eq, gt, isNull } from "drizzle-orm";
import {
  bond402AuthTokensTable,
  db,
} from "@workspace/db";
import {
  AUTH_TOKEN_PURPOSE,
  type AuthTokenPurpose,
  createAuthToken,
  hashAuthToken,
} from "./auth-mail";

export async function issueAuthToken(userId: string, purpose: AuthTokenPurpose, ttlMs: number) {
  const { rawToken, tokenHash } = createAuthToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  await db
    .delete(bond402AuthTokensTable)
    .where(
      and(
        eq(bond402AuthTokensTable.userId, userId),
        eq(bond402AuthTokensTable.purpose, purpose),
        isNull(bond402AuthTokensTable.consumedAt),
      ),
    );
  await db.insert(bond402AuthTokensTable).values({
    id: crypto.randomUUID(),
    userId,
    purpose,
    tokenHash,
    expiresAt,
  });
  return { rawToken, expiresAt };
}

export async function consumeAuthToken(rawToken: string, purpose: AuthTokenPurpose) {
  const tokenHash = hashAuthToken(rawToken);
  return db.transaction(async (tx) => {
    const [storedToken] = await tx
      .select()
      .from(bond402AuthTokensTable)
      .where(
        and(
          eq(bond402AuthTokensTable.tokenHash, tokenHash),
          eq(bond402AuthTokensTable.purpose, purpose),
          gt(bond402AuthTokensTable.expiresAt, new Date()),
          isNull(bond402AuthTokensTable.consumedAt),
        ),
      );
    if (!storedToken) return null;

    const [consumedToken] = await tx
      .update(bond402AuthTokensTable)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(bond402AuthTokensTable.id, storedToken.id),
          isNull(bond402AuthTokensTable.consumedAt),
          gt(bond402AuthTokensTable.expiresAt, new Date()),
        ),
      )
      .returning();
    return consumedToken ?? null;
  });
}

export { AUTH_TOKEN_PURPOSE };