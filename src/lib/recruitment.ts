/**
 * Selection → offer → acceptance → NDA → account → activation → onboarding.
 * Every step is recorded on the candidate timeline and in the audit log.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, s } from "@/db";
import type { CandidateStatus } from "@/db/schema";
import { leadsBody, type Actor, type Org } from "./access";
import { audit } from "./audit";
import { emailLayout, queueEmail } from "./email";
import { notify } from "./notify";
import { lcOf } from "./org";
import { plainSubject, renderTemplate } from "./templates";
import { issueUserToken } from "./tokens";
import { createTask } from "./tasks";
import { setCandidateStatus } from "./onboarding";
export { setCandidateStatus, checkOnboardingComplete } from "./onboarding";
import { addDays, APP_URL, fmtDate, localDate, randomToken, sha256 } from "./util";

export type Candidate = typeof s.candidates.$inferSelect;

export function canManageRecruitment(actor: Actor): boolean {
  return actor.isMCP || actor.system.has("recruitment_admin") || actor.system.has("mx_admin");
}

export function canManageCandidate(actor: Actor, org: Org, c: Candidate): boolean {
  if (canManageRecruitment(actor)) return true;
  if (c.createdById === actor.id) return true;
  const pos = c.positionId ? org.positions.get(c.positionId) : undefined;
  return !!pos && leadsBody(actor, org, pos.bodyId);
}

export async function activeTemplate(kind: (typeof s.templates.$inferSelect)["kind"]) {
  const [t] = await db.select().from(s.templates).where(and(eq(s.templates.kind, kind), eq(s.templates.active, true))).orderBy(desc(s.templates.version)).limit(1);
  return t ?? null;
}

/** Template variables for a candidate. */
export async function candidateVars(org: Org, c: Candidate, extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const pos = c.positionId ? org.positions.get(c.positionId) : undefined;
  const body = pos ? org.bodies.get(pos.bodyId) : undefined;
  const lc = body ? lcOf(org, body.id) : undefined;
  const [term] = await db.select().from(s.terms).where(eq(s.terms.id, c.termId));
  const [mgr] = c.reportingUserId ? await db.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, c.reportingUserId)) : [];
  return {
    candidate_name: c.fullName, preferred_name: c.preferredName ?? c.fullName.split(" ")[0]!, position: pos?.title ?? "",
    department: body?.departmentKey ? (body.shortName ?? body.name) : body?.name ?? "", lc_name: lc?.name ?? "AIESEC in Bangladesh", term: term?.code ?? "",
    start_date: c.startDate ? fmtDate(c.startDate) : "", reporting_manager: mgr?.name ?? "", selection_date: c.selectedAt ? fmtDate(c.selectedAt) : fmtDate(new Date()),
    offer_expiry_date: c.offerExpiresOn ? fmtDate(c.offerExpiresOn) : "", candidate_id: c.id.slice(0, 8).toUpperCase(), portal_link: APP_URL, name: c.email, ...extra,
  };
}

export function missingForOffer(c: Candidate): string[] {
  const missing: string[] = [];
  if (!c.positionId) missing.push("position");
  if (!c.startDate) missing.push("start date");
  if (!c.offerExpiresOn) missing.push("offer expiry date");
  if (!c.reportingUserId) missing.push("reporting manager");
  if (!c.email) missing.push("email");
  return missing;
}

/** Generates a versioned offer, emails the secure link and records everything. Previous open offers are revoked. */
export async function generateAndSendOffer(org: Org, c: Candidate, actorId: string): Promise<{ code: string }> {
  const missing = missingForOffer(c);
  if (missing.length) throw new Error(`Missing: ${missing.join(", ")}`);
  if (!["selected", "offer_generated", "offer_sent", "offer_viewed", "offer_expired"].includes(c.status)) throw new Error("Candidate must be SELECTED before an offer is generated.");
  const tpl = await activeTemplate("offer_letter");
  if (!tpl) throw new Error("No active offer letter template.");
  const [term] = await db.select().from(s.terms).where(eq(s.terms.id, c.termId));
  const seq = (await db.select({ id: s.offers.id }).from(s.offers)).length + 1;
  const code = `AIESEC-BD-${term!.code.replace(".", "-")}-${String(seq).padStart(6, "0")}`;
  const vars = await candidateVars(org, c, { offer_id: code });
  const rendered = renderTemplate(tpl.body, vars);
  const token = randomToken();
  await db.update(s.offers).set({ status: "revoked" }).where(and(eq(s.offers.candidateId, c.id), inArray(s.offers.status, ["generated", "sent", "viewed"])));
  const [offer] = await db
    .insert(s.offers)
    .values({ code, candidateId: c.id, templateId: tpl.id, renderedBody: rendered, contentSha256: sha256(rendered), tokenHash: sha256(token), expiresAt: new Date(`${c.offerExpiresOn}T17:59:59Z`), status: "sent", sentAt: new Date(), createdById: actorId })
    .returning();
  await setCandidateStatus(c.id, "offer_generated", actorId, code);

  const emailTpl = await activeTemplate("email_offer");
  const link = `${APP_URL}/offer/${token}`;
  const ev = { ...vars, offer_link: link };
  await queueEmail(
    c.email,
    plainSubject(emailTpl?.subject ?? "Your AIESEC Bangladesh offer letter", ev),
    emailLayout({ title: "Your offer letter", contentHtml: renderTemplate(emailTpl?.body ?? "Dear {{candidate_name}}, your offer is ready.", ev), cta: { label: "VIEW & ACCEPT OFFER LETTER", url: link }, footerNote: "This offer is personal and confidential. Do not share this link." }),
  );
  await setCandidateStatus(c.id, "offer_sent", actorId);
  await audit(actorId, "offer.generated_and_sent", { type: "offer", id: offer!.id }, { code, candidateId: c.id, templateVersion: tpl.version });
  return { code };
}

export async function findOfferByToken(token: string) {
  const [offer] = await db.select().from(s.offers).where(eq(s.offers.tokenHash, sha256(token))).limit(1);
  if (!offer) return null;
  const [candidate] = await db.select().from(s.candidates).where(eq(s.candidates.id, offer.candidateId));
  return candidate ? { offer, candidate } : null;
}

const BASE_ONBOARDING: { key: string; label: string; task?: { title: string; days: number } }[] = [
  { key: "offer", label: "Offer letter" }, { key: "offer_accept", label: "Offer acceptance" }, { key: "nda", label: "NDA signed" }, { key: "account", label: "Account activation" },
  { key: "profile", label: "Profile completion" }, { key: "jd", label: "Read your position JD" }, { key: "code_of_conduct", label: "Read the Code of Conduct" },
  { key: "aiesec101", label: "Complete AIESEC 101", task: { title: "Complete AIESEC 101", days: 5 } },
  { key: "induction", label: "Attend induction", task: { title: "Attend your induction session", days: 7 } },
  { key: "meet_leader", label: "Meet your leader (1:1)", task: { title: "First 1:1 with your leader", days: 7 } },
  { key: "first_meeting", label: "Attend your first team meeting" }, { key: "first_task", label: "Complete your first task", task: { title: "Your first task: introduce yourself to the team", days: 10 } },
];

const ROLE_EXTRA: Record<string, { key: string; label: string; task?: { title: string; days: number } }[]> = {
  tl: [{ key: "tl_training", label: "Team management & reporting training", task: { title: "Complete TL training: team management, reporting, KPIs", days: 10 } }],
  lcvp: [{ key: "portfolio_sop", label: "Read the department SOP & KPI guide", task: { title: "Read your department SOP, playbook and KPI guide", days: 7 } }, { key: "strategy_alignment", label: "Strategy alignment session" }],
  lcp: [{ key: "governance_docs", label: "Read governance documents & constitution" }, { key: "financial_responsibility", label: "Financial responsibility briefing" }, { key: "risk", label: "Risk management briefing" }],
  mcvp: [{ key: "governance_docs", label: "Read governance documents & constitution" }, { key: "strategy_docs", label: "Read the national strategy" }, { key: "handover", label: "Receive handover from predecessor" }],
  mcp: [{ key: "governance_docs", label: "Read governance documents & constitution" }, { key: "confidentiality", label: "Confidentiality & data-protection briefing" }, { key: "handover", label: "Receive handover from predecessor" }],
};

/** After NDA: create the account (least privilege), assign the position, onboarding checklist + tasks, activation email. */
export async function createAccountForCandidate(org: Org, c: Candidate, actorId: string | null): Promise<string> {
  const email = c.email.toLowerCase();
  let [user] = await db.select().from(s.users).where(eq(s.users.email, email));
  if (!user) {
    [user] = await db.insert(s.users).values({ email, name: c.fullName, preferredName: c.preferredName, phone: c.phone, status: "pending_first_login", userType: "internal", joinedAt: c.startDate ?? localDate() }).returning();
  } else if (user.status === "alumni" || user.status === "archived") {
    await db.update(s.users).set({ status: "active" }).where(eq(s.users.id, user.id));
  }
  const userId = user!.id;
  await db.update(s.candidates).set({ userId }).where(eq(s.candidates.id, c.id));
  await db.update(s.ndaSignatures).set({ userId }).where(eq(s.ndaSignatures.candidateId, c.id));
  if (c.positionId) {
    const [existing] = await db.select().from(s.assignments).where(and(eq(s.assignments.userId, userId), eq(s.assignments.positionId, c.positionId), eq(s.assignments.active, true)));
    if (!existing) await db.insert(s.assignments).values({ userId, positionId: c.positionId, termId: c.termId, startsOn: c.startDate, active: true });
  }
  await setCandidateStatus(c.id, "account_created", actorId);

  // Onboarding checklist (role-dependent) + auto-created tasks assigned by the reporting leader.
  const pos = c.positionId ? org.positions.get(c.positionId) : undefined;
  const items = [...BASE_ONBOARDING, ...(pos ? ROLE_EXTRA[pos.roleKey] ?? [] : [])];
  const assigner = c.reportingUserId ?? actorId ?? userId;
  const [assignerUser] = await db.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, assigner));
  // The new user is not in the cached org snapshot yet; pass a copy that knows the new assignment.
  const orgWithUser: Org = { ...org, userPositions: new Map(org.userPositions), holders: new Map(org.holders) };
  if (pos) {
    orgWithUser.userPositions.set(userId, [...(orgWithUser.userPositions.get(userId) ?? []), pos.id]);
    orgWithUser.holders.set(pos.id, [...(orgWithUser.holders.get(pos.id) ?? []), userId]);
  }
  let order = 0;
  for (const item of items) {
    let taskId: string | null = null;
    if (item.task) {
      const t = await createTask(orgWithUser, assigner, { title: item.task.title, assigneeId: userId, dueAt: new Date(`${addDays(c.startDate ?? localDate(), item.task.days)}T17:59:00Z`), category: "onboarding", bodyId: pos?.bodyId ?? null, priority: "medium" }, { creatorName: assignerUser?.name ?? "Onboarding", skipPermission: true });
      taskId = t.id;
    }
    const done = ["offer", "offer_accept", "nda"].includes(item.key);
    await db.insert(s.onboardingItems).values({ userId, key: item.key, label: item.label, sortOrder: order++, taskId, doneAt: done ? new Date() : null }).onConflictDoNothing();
  }

  const token = await issueUserToken(userId, "activation", 72);
  const tpl = await activeTemplate("email_activation");
  const vars = await candidateVars(org, c);
  await queueEmail(
    email,
    plainSubject(tpl?.subject ?? "Your AIESEC Bangladesh Portal account is ready", vars),
    emailLayout({ title: "Activate your account", contentHtml: renderTemplate(tpl?.body ?? "Dear {{candidate_name}}, your account is ready.", vars), cta: { label: "Activate my account", url: `${APP_URL}/activate/${token}` }, footerNote: "The activation link works once and expires in 72 hours. We will never ask for your password." }),
  );
  if (c.reportingUserId) await notify([c.reportingUserId], { type: "onboarding", priority: "normal", title: `${c.fullName} joined as ${pos?.title ?? "a new member"} — onboarding started`, link: `/people/${userId}` });
  await audit(actorId, "account.created_from_candidate", { type: "user", id: userId }, { candidateId: c.id });
  return userId;
}

