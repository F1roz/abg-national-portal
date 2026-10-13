import { and, eq, gt, isNull } from "drizzle-orm";
import { db, s } from "@/db";
import { randomToken, sha256 } from "./util";

/** Issues a one-time token. Only its hash is stored; the raw value goes into the emailed link. */
export async function issueUserToken(userId: string, purpose: "activation" | "password_reset", hours: number): Promise<string> {
  const raw = randomToken();
  // Invalidate older unused tokens of the same purpose.
  await db.update(s.userTokens).set({ usedAt: new Date() }).where(and(eq(s.userTokens.userId, userId), eq(s.userTokens.purpose, purpose), isNull(s.userTokens.usedAt)));
  await db.insert(s.userTokens).values({ userId, purpose, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + hours * 3_600_000) });
  return raw;
}

export async function findValidToken(raw: string) {
  const [row] = await db
    .select()
    .from(s.userTokens)
    .where(and(eq(s.userTokens.tokenHash, sha256(raw)), isNull(s.userTokens.usedAt), gt(s.userTokens.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}
