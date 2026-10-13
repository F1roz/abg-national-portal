"use server";
import { redirect } from "next/navigation";
import { and, count, eq, gt } from "drizzle-orm";
import { db, s } from "@/db";
import { createSession, getSession, LOCKOUT_MINUTES, MAX_FAILED_LOGINS, requestMeta, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { verifyTotp } from "@/lib/totp";
import { str } from "@/lib/util";
import type { FormState } from "@/components/forms";

const GENERIC = "Email or password is incorrect.";

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  const email = str(form, "email").toLowerCase();
  const password = str(form, "password");
  const meta = await requestMeta();
  if (!email || !password) return { error: "Enter your email and password." };

  // Rate limit by IP: at most 20 failed attempts in 15 minutes from one address.
  if (meta.ip) {
    const since = new Date(Date.now() - 15 * 60_000);
    const [{ n }] = await db.select({ n: count() }).from(s.loginEvents).where(and(eq(s.loginEvents.ip, meta.ip), eq(s.loginEvents.success, false), gt(s.loginEvents.createdAt, since)));
    if (n >= 20) return { error: "Too many attempts from this network. Try again in 15 minutes." };
  }

  const [user] = await db.select().from(s.users).where(eq(s.users.email, email)).limit(1);
  const fail = async (reason: string, msg = GENERIC): Promise<FormState> => {
    await db.insert(s.loginEvents).values({ userId: user?.id ?? null, email, success: false, reason, ip: meta.ip, userAgent: meta.userAgent });
    return { error: msg };
  };

  if (user?.lockedUntil && user.lockedUntil > new Date()) return fail("locked", `Account temporarily locked after repeated failures. Try again after ${LOCKOUT_MINUTES} minutes or reset your password.`);
  const ok = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !ok) {
    if (user) {
      const failed = user.failedLogins + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await db.update(s.users).set({ failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null }).where(eq(s.users.id, user.id));
      if (lock) {
        await audit(user.id, "auth.locked", { type: "user", id: user.id }, {}, meta.ip);
        await notify([user.id], { type: "security", priority: "critical", title: "Your account was locked after repeated failed sign-ins", body: "If this wasn't you, reset your password." });
      }
    }
    return fail("bad_credentials");
  }
  if (["suspended", "archived", "candidate"].includes(user.status)) return fail("inactive", "This account is not active. Contact your MX / IM team.");

  // New-device alert: first successful login with this user agent.
  const previous = await db.select({ ua: s.loginEvents.userAgent }).from(s.loginEvents).where(and(eq(s.loginEvents.userId, user.id), eq(s.loginEvents.success, true)));
  const seen = previous.some((p) => p.ua === meta.userAgent);

  await db.update(s.users).set({ failedLogins: 0, lockedUntil: null }).where(eq(s.users.id, user.id));
  await db.insert(s.loginEvents).values({ userId: user.id, email, success: true, ip: meta.ip, userAgent: meta.userAgent });
  await createSession(user.id, !user.mfaEnabled);
  await audit(user.id, "auth.login", { type: "user", id: user.id }, { mfa: user.mfaEnabled }, meta.ip);
  if (previous.length && !seen) {
    await notify([user.id], { type: "security", priority: "important", title: "New sign-in to your account", body: `A new device signed in (${(meta.userAgent ?? "unknown").slice(0, 80)}). If this wasn't you, change your password and sign out other sessions.`, link: "/security", forceEmail: true });
  }
  redirect(user.mfaEnabled ? "/login/mfa" : "/dashboard");
}

export async function mfaAction(_: FormState, form: FormData): Promise<FormState> {
  const sess = await getSession();
  if (!sess) redirect("/login");
  if (!sess.user.totpSecret) redirect("/dashboard");
  const meta = await requestMeta();
  if (!verifyTotp(sess.user.totpSecret, str(form, "code"))) {
    await db.insert(s.loginEvents).values({ userId: sess.user.id, email: sess.user.email, success: false, reason: "bad_mfa", ip: meta.ip, userAgent: meta.userAgent });
    return { error: "That code didn't work. Check your authenticator app and try again." };
  }
  await db.update(s.sessions).set({ mfaVerified: true }).where(eq(s.sessions.id, sess.session.id));
  redirect("/dashboard");
}
