import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getSession } from "./auth";
import { buildActor, type Actor, type Org } from "./access";
import { getActiveTermRow, historicalPositionIds, loadOrgData, systemRolesOf } from "./org";

export const loadOrg = cache(loadOrgData);
export const getActiveTerm = cache(getActiveTermRow);

export const getActor = cache(async (): Promise<{ actor: Actor; org: Org; mfaVerified: boolean } | null> => {
  const sess = await getSession();
  if (!sess) return null;
  const [org, roles, hist] = await Promise.all([loadOrg(), systemRolesOf(sess.user.id), historicalPositionIds(sess.user.id)]);
  return { actor: buildActor(org, sess.user, roles, hist), org, mfaVerified: sess.session.mfaVerified };
});

export function mfaRequired(actor: Actor): boolean {
  if (process.env.ENFORCE_LEADER_MFA === "false") return false;
  return actor.isLeader || actor.isMC || actor.system.size > 0 || actor.roleKeys.has("ecb") || actor.roleKeys.has("esc") || actor.roleKeys.has("efb");
}

/**
 * Gatekeeper for every portal page and server action.
 * Order: signed in → MFA challenge passed → password rotated → MFA enrolled (leaders) → onboarding basics done.
 */
export async function requireActor(opts: { stage?: "full" | "onboarding" | "security" } = {}): Promise<{ actor: Actor; org: Org }> {
  const ctx = await getActor();
  if (!ctx) redirect("/login");
  const { actor, org, mfaVerified } = ctx;
  const stage = opts.stage ?? "full";
  if (actor.user.mfaEnabled && !mfaVerified) redirect("/login/mfa");
  if (actor.user.mustChangePassword && stage !== "security") redirect("/welcome/password");
  if (stage === "full") {
    if (mfaRequired(actor) && !actor.user.mfaEnabled) redirect("/security?enrol=1");
    if (!actor.user.termsAcceptedAt || !actor.user.profileCompletedAt) redirect("/welcome");
  }
  if (actor.isExternal && stage === "full") redirect("/external");
  return { actor, org };
}

export function denied(): never {
  redirect("/forbidden");
}
