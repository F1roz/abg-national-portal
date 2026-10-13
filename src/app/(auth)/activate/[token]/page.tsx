import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, s } from "@/db";
import { ActionForm, SubmitButton, type FormState } from "@/components/forms";
import { findValidToken } from "@/lib/tokens";
import { createSession, hashPassword, passwordProblem, revokeAllSessions } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { str } from "@/lib/util";

export const metadata = { title: "Set your password" };

async function setPassword(_: FormState, form: FormData): Promise<FormState> {
  "use server";
  const tok = await findValidToken(str(form, "token"));
  if (!tok) return { error: "This link has expired or was already used. Request a new one." };
  const [user] = await db.select().from(s.users).where(eq(s.users.id, tok.userId));
  if (!user) return { error: "Account not found." };
  const pw = str(form, "password");
  if (pw !== str(form, "confirm")) return { error: "Passwords don't match." };
  const problem = passwordProblem(pw, user.email);
  if (problem) return { error: problem };
  await db.update(s.userTokens).set({ usedAt: new Date() }).where(eq(s.userTokens.id, tok.id));
  await db
    .update(s.users)
    .set({ passwordHash: await hashPassword(pw), mustChangePassword: false, failedLogins: 0, lockedUntil: null, status: user.status === "pending_first_login" ? "active" : user.status })
    .where(eq(s.users.id, user.id));
  await revokeAllSessions(user.id);
  await audit(user.id, tok.purpose === "activation" ? "account.activated" : "auth.password_reset", { type: "user", id: user.id });
  if (tok.purpose === "activation") {
    await db.update(s.candidates).set({ status: "account_activated" }).where(eq(s.candidates.userId, user.id));
    await db.update(s.onboardingItems).set({ doneAt: new Date() }).where(and(eq(s.onboardingItems.userId, user.id), eq(s.onboardingItems.key, "account")));
  }
  await createSession(user.id, !user.mfaEnabled);
  redirect(user.mfaEnabled ? "/login/mfa" : "/welcome");
}

export default async function ActivatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tok = await findValidToken(token);
  if (!tok) {
    return (
      <>
        <h1 className="mb-2 text-lg font-bold">Link expired</h1>
        <p className="text-sm text-gray-500">This link has expired or was already used.</p>
        <Link href="/forgot" className="btn-primary mt-4 w-full">Request a new link</Link>
      </>
    );
  }
  return (
    <>
      <h1 className="mb-1 text-lg font-bold">{tok.purpose === "activation" ? "Activate your account" : "Choose a new password"}</h1>
      <p className="mb-4 text-sm text-gray-500">At least 10 characters, mixing letters with numbers or symbols.</p>
      <ActionForm action={setPassword}>
        <input type="hidden" name="token" value={token} />
        <input name="password" type="password" autoComplete="new-password" required minLength={10} placeholder="New password" className="input" />
        <input name="confirm" type="password" autoComplete="new-password" required minLength={10} placeholder="Repeat password" className="input" />
        <SubmitButton className="btn-primary w-full">Save password</SubmitButton>
      </ActionForm>
    </>
  );
}
