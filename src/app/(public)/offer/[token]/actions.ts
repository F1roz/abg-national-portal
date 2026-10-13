"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, s } from "@/db";
import { requestMeta } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { createAccountForCandidate, findOfferByToken, setCandidateStatus, activeTemplate, candidateVars } from "@/lib/recruitment";
import { loadOrgData } from "@/lib/org";
import { renderTemplate } from "@/lib/templates";
import { sha256, str } from "@/lib/util";
import type { FormState } from "@/components/forms";

async function recruiters(): Promise<string[]> {
  const rows = await db.select({ userId: s.systemRoles.userId }).from(s.systemRoles).where(eq(s.systemRoles.role, "recruitment_admin"));
  return rows.map((r) => r.userId);
}

export async function acceptOfferAction(_: FormState, form: FormData): Promise<FormState> {
  const token = str(form, "token");
  const found = await findOfferByToken(token);
  if (!found) return { error: "This link is not valid." };
  const { offer, candidate } = found;
  if (offer.status !== "sent" && offer.status !== "viewed") return { error: "This offer can no longer be accepted." };
  if (offer.expiresAt < new Date()) return { error: "This offer has expired. Please contact the recruitment team." };
  // Identity check: the candidate confirms the email address the offer was sent to.
  if (str(form, "email").toLowerCase() !== candidate.email.toLowerCase()) return { error: "That email doesn't match the one this offer was sent to." };
  if (form.get("confirm") !== "on") return { error: "Please confirm you have read and accept the offer." };
  const meta = await requestMeta();
  await db.update(s.offers).set({ status: "accepted", decidedAt: new Date(), decisionMeta: { ip: meta.ip, userAgent: meta.userAgent, contentSha256: offer.contentSha256, templateId: offer.templateId } }).where(eq(s.offers.id, offer.id));
  await setCandidateStatus(candidate.id, "offer_accepted", null, offer.code);
  await setCandidateStatus(candidate.id, "nda_pending", null);
  await audit(null, "offer.accepted", { type: "offer", id: offer.id }, { code: offer.code, candidateId: candidate.id }, meta.ip);
  await notify([...(await recruiters()), ...(candidate.reportingUserId ? [candidate.reportingUserId] : [])], { type: "onboarding", priority: "normal", title: `${candidate.fullName} accepted offer ${offer.code}`, link: `/recruitment/${candidate.id}` });
  redirect(`/offer/${token}/nda`);
}

export async function declineOfferAction(_: FormState, form: FormData): Promise<FormState> {
  const token = str(form, "token");
  const found = await findOfferByToken(token);
  if (!found) return { error: "This link is not valid." };
  const { offer, candidate } = found;
  if (offer.status !== "sent" && offer.status !== "viewed") return { error: "This offer can no longer be changed." };
  if (str(form, "email").toLowerCase() !== candidate.email.toLowerCase()) return { error: "That email doesn't match the one this offer was sent to." };
  const meta = await requestMeta();
  await db.update(s.offers).set({ status: "declined", decidedAt: new Date(), declineReason: str(form, "reason").slice(0, 1000) || null, decisionMeta: { ip: meta.ip, userAgent: meta.userAgent } }).where(eq(s.offers.id, offer.id));
  await setCandidateStatus(candidate.id, "offer_declined", null, str(form, "reason") || undefined);
  await audit(null, "offer.declined", { type: "offer", id: offer.id }, { code: offer.code }, meta.ip);
  await notify(await recruiters(), { type: "onboarding", priority: "important", title: `${candidate.fullName} declined offer ${offer.code}`, link: `/recruitment/${candidate.id}` });
  return { ok: true, message: "Thank you for letting us know. We wish you all the best." };
}

export async function signNdaAction(_: FormState, form: FormData): Promise<FormState> {
  const token = str(form, "token");
  const found = await findOfferByToken(token);
  if (!found) return { error: "This link is not valid." };
  const { offer, candidate } = found;
  if (offer.status !== "accepted" || candidate.status !== "nda_pending") return { error: "The NDA isn't pending for this offer." };
  if (form.get("confirm") !== "on") return { error: "Please confirm you agree to the NDA." };
  const typed = str(form, "signedName").replace(/\s+/g, " ").toLowerCase();
  if (typed !== candidate.fullName.replace(/\s+/g, " ").toLowerCase()) return { error: `Type your full legal name exactly as on the offer (${candidate.fullName}).` };
  const tpl = await activeTemplate("nda");
  if (!tpl) return { error: "NDA template missing — contact the recruitment team." };
  const org = await loadOrgData();
  const content = renderTemplate(tpl.body, await candidateVars(org, candidate));
  if (sha256(content) !== str(form, "contentHash")) return { error: "The NDA was updated while you were reading. Please reload and review the current version." };
  const meta = await requestMeta();
  await db.insert(s.ndaSignatures).values({ candidateId: candidate.id, templateId: tpl.id, contentSha256: sha256(content), signedName: str(form, "signedName"), ip: meta.ip, userAgent: meta.userAgent });
  await setCandidateStatus(candidate.id, "nda_signed", null, `NDA v${tpl.version}`);
  await audit(null, "nda.signed", { type: "candidate", id: candidate.id }, { version: tpl.version }, meta.ip);
  await createAccountForCandidate(org, { ...candidate, status: "nda_signed" }, null);
  redirect(`/offer/${token}/nda?done=1`);
}
