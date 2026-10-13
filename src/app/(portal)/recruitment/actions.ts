"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, s } from "@/db";
import { CANDIDATE_STATUSES, type CandidateStatus } from "@/db/schema";
import { requireActor } from "@/lib/session";
import { leadsBody } from "@/lib/access";
import { canManageCandidate, canManageRecruitment, generateAndSendOffer, setCandidateStatus } from "@/lib/recruitment";
import { audit } from "@/lib/audit";
import { optStr, str } from "@/lib/util";
import type { FormState } from "@/components/forms";

export async function addCandidateAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor, org } = await requireActor();
  const positionId = optStr(form, "positionId");
  const pos = positionId ? org.positions.get(positionId) : undefined;
  if (!canManageRecruitment(actor) && !(pos && leadsBody(actor, org, pos.bodyId))) return { error: "You can add candidates only for positions in bodies you lead." };
  const email = str(form, "email").toLowerCase();
  if (!str(form, "fullName") || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Full name and a valid email are required." };
  const [c] = await db.insert(s.candidates).values({ fullName: str(form, "fullName"), preferredName: optStr(form, "preferredName"), email, phone: optStr(form, "phone"), termId: org.termId, positionId, reportingUserId: optStr(form, "reportingUserId"), startDate: optStr(form, "startDate"), offerExpiresOn: optStr(form, "offerExpiresOn"), status: "applied", createdById: actor.id }).returning();
  await setCandidateStatus(c!.id, "applied", actor.id, "Added to pipeline");
  redirect(`/recruitment/${c!.id}`);
}

async function load(id: string) {
  const ctx = await requireActor();
  const [c] = await db.select().from(s.candidates).where(eq(s.candidates.id, id));
  if (!c || !canManageCandidate(ctx.actor, ctx.org, c)) throw new Error("Not allowed");
  return { ...ctx, c };
}

export async function updateCandidateAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor, c } = await load(str(form, "id"));
  await db.update(s.candidates).set({
    fullName: str(form, "fullName") || c.fullName, preferredName: optStr(form, "preferredName"), phone: optStr(form, "phone"), positionId: optStr(form, "positionId"),
    reportingUserId: optStr(form, "reportingUserId"), startDate: optStr(form, "startDate"), offerExpiresOn: optStr(form, "offerExpiresOn"), notes: optStr(form, "notes"),
  }).where(eq(s.candidates.id, c.id));
  await audit(actor.id, "candidate.updated", { type: "candidate", id: c.id });
  revalidatePath(`/recruitment/${c.id}`);
  return { ok: true, message: "Saved." };
}

const MANUAL: CandidateStatus[] = ["shortlisted", "assessed", "interviewed", "selected", "rejected", "withdrawn"];

export async function moveCandidateAction(form: FormData) {
  const { actor, c } = await load(str(form, "id"));
  const status = str(form, "status") as CandidateStatus;
  if (!CANDIDATE_STATUSES.includes(status) || !MANUAL.includes(status)) return;
  await setCandidateStatus(c.id, status, actor.id, optStr(form, "note") ?? undefined);
  await audit(actor.id, `candidate.${status}`, { type: "candidate", id: c.id });
  revalidatePath(`/recruitment/${c.id}`);
}

export async function sendOfferAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor, org, c } = await load(str(form, "id"));
  try {
    const { code } = await generateAndSendOffer(org, c, actor.id);
    revalidatePath(`/recruitment/${c.id}`);
    return { ok: true, message: `Offer ${code} generated and emailed to ${c.email}.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
