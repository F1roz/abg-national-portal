import "server-only";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, s } from "@/db";
import { randomToken, sha256 } from "./util";

export const SESSION_COOKIE = "abg_session";
const ABSOLUTE_TTL_MS = 7 * 24 * 3600_000;
const IDLE_TTL_MS = 12 * 3600_000;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

let dummyHash: string | undefined;

export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  if (!hash) {
    // Spend comparable time so missing accounts are not distinguishable by timing.
    dummyHash ??= await bcrypt.hash("not-a-real-password", 12);
    await bcrypt.compare(password, dummyHash);
    return false;
  }
  return bcrypt.compare(password, hash);
}

const COMMON = new Set(["password", "password123", "12345678", "123456789", "qwerty123", "aiesec123", "aiesecbangladesh", "letmein123"]);

export function passwordProblem(pw: string, email?: string): string | null {
  if (pw.length < 10) return "Use at least 10 characters.";
  if (pw.length > 128) return "Use at most 128 characters.";
  if (COMMON.has(pw.toLowerCase())) return "That password is too common.";
  if (email && pw.toLowerCase().includes(email.split("@")[0]!.toLowerCase())) return "Don't include your email name in the password.";
  if (!/[a-zA-Z]/.test(pw) || !/[0-9\W]/.test(pw)) return "Mix letters with numbers or symbols.";
  return null;
}

export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  return { ip: fwd ? fwd.split(",")[0]!.trim() : h.get("x-real-ip"), userAgent: h.get("user-agent") };
}

export async function createSession(userId: string, mfaVerified: boolean): Promise<void> {
  const token = randomToken();
  const meta = await requestMeta();
  await db.insert(s.sessions).values({
    id: sha256(token), userId, mfaVerified, expiresAt: new Date(Date.now() + ABSOLUTE_TTL_MS), ip: meta.ip, userAgent: meta.userAgent,
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: ABSOLUTE_TTL_MS / 1000,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.update(s.sessions).set({ revokedAt: new Date() }).where(eq(s.sessions.id, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

export async function revokeAllSessions(userId: string, exceptCurrent = false): Promise<void> {
  const token = exceptCurrent ? (await cookies()).get(SESSION_COOKIE)?.value : undefined;
  const rows = await db.select({ id: s.sessions.id }).from(s.sessions).where(and(eq(s.sessions.userId, userId), isNull(s.sessions.revokedAt)));
  for (const r of rows) {
    if (token && r.id === sha256(token)) continue;
    await db.update(s.sessions).set({ revokedAt: new Date() }).where(eq(s.sessions.id, r.id));
  }
}

export type SessionInfo = { session: typeof s.sessions.$inferSelect; user: typeof s.users.$inferSelect };

/** Current session (memoised per request). Enforces idle + absolute expiry and revocation. */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const now = new Date();
  const [row] = await db
    .select({ session: s.sessions, user: s.users })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .where(and(eq(s.sessions.id, sha256(token)), gt(s.sessions.expiresAt, now), isNull(s.sessions.revokedAt)))
    .limit(1);
  if (!row) return null;
  if (now.getTime() - row.session.lastSeenAt.getTime() > IDLE_TTL_MS) return null;
  if (row.user.status === "suspended" || row.user.status === "archived") return null;
  if (now.getTime() - row.session.lastSeenAt.getTime() > 5 * 60_000) {
    await db.update(s.sessions).set({ lastSeenAt: now }).where(eq(s.sessions.id, row.session.id));
  }
  return row;
});
