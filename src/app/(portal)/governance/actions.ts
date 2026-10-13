"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { canManageBody, canViewBodyWork, holdersOfBody } from "@/lib/access";
import { tallyMotion } from "@/lib/governance";
import { notify } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { optStr, parseLocalDateTime, str } from "@/lib/util";
import type { FormState } from "@/components/forms";

export async function createMotionAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor, org } = await requireActor();
  const bodyId = str(form, "bodyId");
  const body = org.bodies.get(bodyId);
  if (!body || !(actor.ledBodyIds.has(bodyId) || actor.system.has("governance_admin"))) return { error: "Only the chair of the voting body (or governance admin) can open a motion." };
  const closesAt = parseLocalDateTime(str(form, "closesAt"));
  const quorum = Number(str(form, "quorum"));
  if (!str(form, "title") || !closesAt || !(quorum > 0)) return { error: "Title, closing time and quorum are required." };
  const count = (await db.select().from(s.motions).where(eq(s.motions.termId, org.termId))).length + 1;
  const [term] = await db.select().from(s.terms).where(eq(s.terms.id, org.termId));
  const code = `${(body.shortName ?? "MOT").replace(/\s+/g, "").toUpperCase()}-${term!.code.replace(".", "")}-${String(count).padStart(3, "0")}`;
  const [m] = await db.insert(s.motions).values({ code, title: str(form, "title"), description: optStr(form, "description"), termId: org.termId, bodyId, quorum, closesAt, createdById: actor.id }).returning();
  await notify(holdersOfBody(org, bodyId), { type: "governance", priority: "important", title: `🗳 New motion ${code}: ${m!.title}`, body: `Voting closes ${closesAt.toISOString().slice(0, 16).replace("T", " ")} UTC`, link: "/governance" });
  await audit(actor.id, "motion.opened", { type: "motion", id: m!.id }, { code, bodyId, quorum });
  revalidatePath("/governance");
  return { ok: true, message: `Motion ${code} opened.` };
}

export async function voteAction(form: FormData) {
  const { actor, org } = await requireActor();
  const [m] = await db.select().from(s.motions).where(eq(s.motions.id, str(form, "id")));
  if (!m || m.status !== "open" || m.closesAt < new Date()) return;
  if (!holdersOfBody(org, m.bodyId).includes(actor.id)) return;
  const choice = str(form, "choice") as "approve" | "reject" | "abstain";
  if (!["approve", "reject", "abstain"].includes(choice)) return;
  const [existing] = await db.select().from(s.votes).where(and(eq(s.votes.motionId, m.id), eq(s.votes.userId, actor.id)));
  if (existing) return; // votes are final
  await db.insert(s.votes).values({ motionId: m.id, userId: actor.id, choice });
  await audit(actor.id, "motion.voted", { type: "motion", id: m.id }, { code: m.code });
  revalidatePath("/governance");
}

export async function closeMotionAction(form: FormData) {
  const { actor, org } = await requireActor();
  const [m] = await db.select().from(s.motions).where(eq(s.motions.id, str(form, "id")));
  if (!m || !(actor.ledBodyIds.has(m.bodyId) || actor.system.has("governance_admin"))) return;
  await tallyMotion(org, m.id, actor.id);
  revalidatePath("/governance");
}

export async function createDecisionAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor, org } = await requireActor();
  const bodyId = str(form, "bodyId");
  if (!canManageBody(actor, org, bodyId) || !canViewBodyWork(actor, org, bodyId)) return { error: "You can log decisions for bodies you lead." };
  if (!str(form, "title")) return { error: "Describe the decision." };
  const body = org.bodies.get(bodyId)!;
  const n = (await db.select().from(s.decisions).where(eq(s.decisions.termId, org.termId))).length + 1;
  const [term] = await db.select().from(s.terms).where(eq(s.terms.id, org.termId));
  const code = `${(body.shortName ?? body.type).replace(/\s+/g, "").toUpperCase().slice(0, 8)}-${term!.code.replace(".", "")}-${String(n).padStart(3, "0")}`;
  await db.insert(s.decisions).values({ code, title: str(form, "title"), description: optStr(form, "description"), termId: org.termId, bodyId, decidedById: actor.id, responsibleId: optStr(form, "responsibleId"), deadline: optStr(form, "deadline"), decidedOn: new Date().toISOString().slice(0, 10) });
  await audit(actor.id, "decision.logged", { type: "body", id: bodyId }, { code });
  revalidatePath("/governance");
  return { ok: true, message: `Decision ${code} logged.` };
}

export async function decisionStatusAction(form: FormData) {
  const { actor, org } = await requireActor();
  const [d] = await db.select().from(s.decisions).where(eq(s.decisions.id, str(form, "id")));
  if (!d || !(canManageBody(actor, org, d.bodyId) || d.responsibleId === actor.id)) return;
  const status = str(form, "status") as "open" | "in_progress" | "done" | "reversed";
  if (!["open", "in_progress", "done", "reversed"].includes(status)) return;
  await db.update(s.decisions).set({ status }).where(eq(s.decisions.id, d.id));
  revalidatePath("/governance");
}
