"use server";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, s } from "@/db";
import { hashPassword, passwordProblem, revokeAllSessions, verifyPassword } from "@/lib/auth";
import { requireActor } from "@/lib/session";
import { audit } from "@/lib/audit";
import { checkOnboardingComplete } from "@/lib/onboarding";
import { str } from "@/lib/util";
import type { FormState } from "@/components/forms";

export async function changePasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor } = await requireActor({ stage: "security" });
  const current = str(form, "current");
  const pw = str(form, "password");
  if (!(await verifyPassword(current, actor.user.passwordHash))) return { error: "Your current password is incorrect." };
  if (pw !== str(form, "confirm")) return { error: "Passwords don't match." };
  if (pw === current) return { error: "Choose a password different from the temporary one." };
  const problem = passwordProblem(pw, actor.user.email);
  if (problem) return { error: problem };
  await db.update(s.users).set({ passwordHash: await hashPassword(pw), mustChangePassword: false }).where(eq(s.users.id, actor.id));
  await revokeAllSessions(actor.id, true);
  await audit(actor.id, "auth.password_changed", { type: "user", id: actor.id });
  if (form.get("redirect") === "welcome") redirect("/welcome");
  return { ok: true, message: "Password changed. Other sessions were signed out." };
}

export async function completeWelcomeAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor } = await requireActor({ stage: "onboarding" });
  if (form.get("terms") !== "on") return { error: "Please accept the portal terms of use." };
  const phone = str(form, "phone");
  const university = str(form, "university");
  if (!phone || !university) return { error: "Phone and university are required." };
  await db
    .update(s.users)
    .set({
      preferredName: str(form, "preferredName") || null, phone, university, termsAcceptedAt: actor.user.termsAcceptedAt ?? new Date(), profileCompletedAt: new Date(),
      emergencyContact: str(form, "emergencyContact") || null,
    })
    .where(eq(s.users.id, actor.id));
  await db.update(s.onboardingItems).set({ doneAt: new Date() }).where(and(eq(s.onboardingItems.userId, actor.id), eq(s.onboardingItems.key, "profile")));
  await db.update(s.candidates).set({ status: "onboarding_in_progress" }).where(and(eq(s.candidates.userId, actor.id), eq(s.candidates.status, "account_activated")));
  await audit(actor.id, "profile.completed", { type: "user", id: actor.id });
  await checkOnboardingComplete(actor.id);
  redirect("/onboarding?welcome=1");
}
