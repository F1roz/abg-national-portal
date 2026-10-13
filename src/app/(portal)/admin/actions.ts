"use server";
import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { db, s } from "@/db";
import { BODY_TYPES, ROLE_KEYS, SYSTEM_ROLES, TEMPLATE_KINDS, type BodyType, type RoleKey, type SystemRole } from "@/db/schema";
import { requireActor, denied } from "@/lib/session";
import { supervisorChain, type Actor } from "@/lib/access";
import { cloneTermStructure, closeTerm, createBody, createPosition } from "@/lib/provision";
import { issueUserToken } from "@/lib/tokens";
import { emailLayout, queueEmail } from "@/lib/email";
import { notify } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { saveSettings, type Settings } from "@/lib/settings";
import { logTask } from "@/lib/tasks";
import { runAll } from "@/jobs/engine";
import { APP_URL, escapeHtml, optStr, str } from "@/lib/util";
import type { FormState } from "@/components/forms";

const isAdmin = (a: Actor) => a.isMCP || a.system.has("system_admin") || a.system.has("im_admin");

async function admin() {
  const ctx = await requireActor();
  if (!isAdmin(ctx.actor)) denied();
  return ctx;
}

// ── Terms ──
export async function createTermAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor } = await admin();
  const code = str(form, "code");
  if (!/^\d{2}\.\d{2}$/.test(code)) return { error: "Term code looks like 27.28" };
  const [t] = await db.insert(s.terms).values({ code, name: `Term 20${code}`, startsOn: str(form, "startsOn"), endsOn: str(form, "endsOn"), status: "planning" }).onConflictDoNothing().returning();
  if (!t) return { error: "That term already exists." };
  const from = optStr(form, "cloneFrom");
  let msg = `Term ${code} created.`;
  if (from) {
    const r = await cloneTermStructure(from, t.id, actor.id);
    msg += ` Structure cloned: ${r.bodies} bodies, ${r.positions} positions (with fresh trackers & KPIs). Staff it through recruitment or Structure.`;
  }
  await audit(actor.id, "term.created", { type: "term", id: t.id }, { code, clonedFrom: from });
  revalidatePath("/admin/terms");
  return { ok: true, message: msg };
}

export async function activateTermAction(form: FormData) {
  const { actor } = await admin();
  if (!actor.isMCP && !actor.system.has("system_admin")) return;
  const id = str(form, "id");
  const [current] = await db.select().from(s.terms).where(eq(s.terms.status, "active"));
  if (current && current.id !== id && form.get("closeCurrent") === "on") await closeTerm(current.id, actor.id);
  else if (current && current.id !== id) await db.update(s.terms).set({ status: "planning" }).where(eq(s.terms.id, current.id));
  await db.update(s.terms).set({ status: "active" }).where(eq(s.terms.id, id));
  await audit(actor.id, "term.activated", { type: "term", id }, { closedPrevious: form.get("closeCurrent") === "on" });
  revalidatePath("/", "layout");
}

export async function closeTermAction(form: FormData) {
  const { actor } = await admin();
  if (!actor.isMCP && !actor.system.has("system_admin")) return;
  if (str(form, "confirm") !== "CLOSE") return;
  const id = str(form, "id");
  const r = await closeTerm(id, actor.id);
  await audit(actor.id, "term.closed", { type: "term", id }, r);
  revalidatePath("/", "layout");
}

// ── Structure ──
export async function createBodyAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor, org } = await admin();
  const type = str(form, "type") as BodyType;
  if (!BODY_TYPES.includes(type) || !str(form, "name")) return { error: "Type and name are required." };
  const parentId = optStr(form, "parentId");
  const termId = parentId ? org.bodies.get(parentId)?.termId ?? org.termId : str(form, "termId") || org.termId;
  const body = await createBody({
    termId, type, name: str(form, "name"), shortName: optStr(form, "shortName") ?? undefined, parentId, departmentKey: optStr(form, "departmentKey")?.toUpperCase() ?? null,
    lineageKey: optStr(form, "lineageKey"), description: optStr(form, "description"), visibility: form.get("confidential") === "on" ? "confidential" : undefined,
    startsOn: optStr(form, "startsOn"), endsOn: optStr(form, "endsOn"), createdById: actor.id,
  });
  for (const l of form.getAll("linkIds").map(String).filter(Boolean)) await db.insert(s.bodyLinks).values({ bodyId: body.id, linkedBodyId: l }).onConflictDoNothing();
  await audit(actor.id, "body.created", { type: "body", id: body.id }, { type, name: body.name });
  revalidatePath("/admin/structure");
  return { ok: true, message: `${body.name} created with its default tracker.` };
}

export async function closeBodyAction(form: FormData) {
  const { actor } = await admin();
  const id = str(form, "id");
  await db.update(s.bodies).set({ status: "closed" }).where(eq(s.bodies.id, id));
  await db.update(s.trackers).set({ frozen: true, frozenAt: new Date() }).where(eq(s.trackers.bodyId, id));
  await audit(actor.id, "body.closed", { type: "body", id });
  revalidatePath("/admin/structure");
}

export async function createPositionAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor } = await admin();
  const roleKey = str(form, "roleKey") as RoleKey;
  if (!ROLE_KEYS.includes(roleKey) || !str(form, "title") || !str(form, "bodyId")) return { error: "Body, title and role are required." };
  const p = await createPosition({ bodyId: str(form, "bodyId"), title: str(form, "title"), roleKey, reportsToId: optStr(form, "reportsToId"), isLeader: form.get("isLeader") === "on", multiHolder: form.get("multiHolder") === "on", jd: { purpose: optStr(form, "purpose") ?? undefined } });
  await audit(actor.id, "position.created", { type: "position", id: p.id }, { title: p.title, roleKey });
  revalidatePath("/admin/structure");
  return { ok: true, message: `Position ${p.title} created.` };
}

export async function assignAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor, org } = await admin();
  const pos = org.positions.get(str(form, "positionId"));
  const userId = str(form, "userId");
  if (!pos || !userId) return { error: "Choose a position and a person." };
  const holders = org.holders.get(pos.id) ?? [];
  if (!pos.multiHolder && holders.length) return { error: "That position is already held. End the current assignment first (offboarding)." };
  // Two-person rule: MCP and MCVP changes need a second administrator's approval.
  if (pos.roleKey === "mcp" || pos.roleKey === "mcvp") {
    const reason = str(form, "reason") || `Assign ${pos.title}`;
    const [r] = await db.insert(s.approvalRequests).values({ action: "assign_position", payload: { userId, positionId: pos.id, startsOn: str(form, "startsOn") }, reason, requestedById: actor.id }).returning();
    const approvers = (await db.select({ userId: s.systemRoles.userId }).from(s.systemRoles).where(eq(s.systemRoles.role, "system_admin"))).map((x) => x.userId).filter((u) => u !== actor.id);
    await notify(approvers, { type: "security", priority: "important", title: `Approval needed: assign ${pos.title}`, body: reason, link: "/admin/roles" });
    await audit(actor.id, "approval.requested", { type: "approval", id: r!.id }, { action: "assign_position", positionId: pos.id, userId });
    return { ok: true, message: `${pos.title} is a critical position — an approval request was sent to a second administrator.` };
  }
  await performAssignment(actor.id, pos.id, userId, optStr(form, "startsOn"));
  revalidatePath("/admin/structure");
  return { ok: true, message: "Assigned." };
}

async function performAssignment(actorId: string, positionId: string, userId: string, startsOn: string | null) {
  const { org } = await requireActor();
  const pos = org.positions.get(positionId)!;
  const body = org.bodies.get(pos.bodyId)!;
  await db.insert(s.assignments).values({ userId, positionId: pos.id, termId: body.termId, startsOn, active: true });
  await db.update(s.users).set({ status: "active" }).where(and(eq(s.users.id, userId), inArray(s.users.status, ["alumni"])));
  await notify([userId], { type: "onboarding", priority: "important", title: `You've been assigned as ${pos.title} — ${body.name}`, link: "/my-position" });
  await audit(actorId, "assignment.created", { type: "position", id: pos.id }, { userId, title: pos.title });
}

/**
 * Offboarding: ends the assignment, transfers open tasks to the supervisor, revokes sessions,
 * and moves the person to alumni if they hold no other position. Historical records stay attached.
 */
export async function endAssignmentAction(form: FormData) {
  const { actor, org } = await admin();
  const [a] = await db.select().from(s.assignments).where(eq(s.assignments.id, str(form, "id")));
  if (!a || !a.active) return;
  const pos = org.positions.get(a.positionId);
  const successor = supervisorChain(org, a.userId)[0]?.[0] ?? null;
  await db.update(s.assignments).set({ active: false, endsOn: new Date().toISOString().slice(0, 10) }).where(eq(s.assignments.id, a.id));
  let transferred = 0;
  if (pos && successor) {
    const open = await db.select().from(s.tasks).where(and(eq(s.tasks.assigneeId, a.userId), eq(s.tasks.bodyId, pos.bodyId), notInArray(s.tasks.status, ["completed", "rejected"])));
    for (const t of open) {
      await db.update(s.tasks).set({ assigneeId: successor }).where(eq(s.tasks.id, t.id));
      await logTask(t.id, actor.id, "reassigned", "Transferred to supervisor during offboarding");
      transferred++;
    }
    if (transferred) await notify([successor], { type: "task_assigned", priority: "important", title: `${transferred} task(s) transferred to you after an offboarding`, link: "/tasks" });
  }
  const others = await db.select().from(s.assignments).where(and(eq(s.assignments.userId, a.userId), eq(s.assignments.active, true)));
  if (!others.length) {
    await db.update(s.users).set({ status: "alumni" }).where(eq(s.users.id, a.userId));
    await db.update(s.sessions).set({ revokedAt: new Date() }).where(eq(s.sessions.userId, a.userId));
  }
  await audit(actor.id, "assignment.ended", { type: "position", id: a.positionId }, { userId: a.userId, transferred, alumni: !others.length });
  revalidatePath("/admin/structure");
}

// ── Users ──
export async function createUserAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor } = await admin();
  const email = str(form, "email").toLowerCase();
  if (!str(form, "name") || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Name and valid email required." };
  const userType = (["internal", "partner", "boa"].includes(str(form, "userType")) ? str(form, "userType") : "internal") as "internal" | "partner" | "boa";
  const [u] = await db.insert(s.users).values({ email, name: str(form, "name"), status: "pending_first_login", userType }).onConflictDoNothing().returning();
  if (!u) return { error: "A user with that email exists." };
  const token = await issueUserToken(u.id, "activation", 72);
  await queueEmail(email, "🔐 Your AIESEC Bangladesh Portal account is ready", emailLayout({ title: "Activate your account", contentHtml: `<p>Dear ${escapeHtml(u.name)},</p><p>An account has been created for you on the AIESEC in Bangladesh portal. Set your password with the button below (valid 72 hours, single use).</p>`, cta: { label: "Activate my account", url: `${APP_URL}/activate/${token}` } }));
  await audit(actor.id, "user.created", { type: "user", id: u.id }, { userType });
  revalidatePath("/admin/users");
  return { ok: true, message: `Account created; activation email queued for ${email}.` };
}

export async function setUserStatusAction(form: FormData) {
  const { actor } = await admin();
  const id = str(form, "id");
  const status = str(form, "status") as "active" | "suspended" | "archived" | "alumni";
  if (!["active", "suspended", "archived", "alumni"].includes(status) || id === actor.id) return;
  await db.update(s.users).set({ status }).where(eq(s.users.id, id));
  if (status !== "active") await db.update(s.sessions).set({ revokedAt: new Date() }).where(eq(s.sessions.userId, id));
  await audit(actor.id, `user.${status}`, { type: "user", id });
  revalidatePath("/admin/users");
}

export async function sendResetAction(form: FormData) {
  const { actor } = await admin();
  const [u] = await db.select().from(s.users).where(eq(s.users.id, str(form, "id")));
  if (!u) return;
  const token = await issueUserToken(u.id, u.passwordHash ? "password_reset" : "activation", u.passwordHash ? 1 : 72);
  await queueEmail(u.email, "AIESEC Bangladesh Portal — set your password", emailLayout({ title: "Set your password", contentHtml: `<p>Hi ${escapeHtml(u.name)}, an administrator sent you a link to set your portal password.</p>`, cta: { label: "Set password", url: `${APP_URL}/activate/${token}` } }));
  await audit(actor.id, "user.reset_link_sent", { type: "user", id: u.id });
  revalidatePath("/admin/users");
}

// ── Two-person approvals ──
export async function requestApprovalAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor } = await admin();
  const action = str(form, "action") as "grant_system_role" | "revoke_system_role" | "bulk_export";
  if (!["grant_system_role", "revoke_system_role", "bulk_export"].includes(action)) return { error: "Unknown action." };
  const reason = str(form, "reason");
  if (!reason) return { error: "A reason is required (it is kept in the audit log)." };
  const payload: Record<string, string> = action === "bulk_export" ? { dataset: str(form, "dataset") } : { userId: str(form, "userId"), role: str(form, "role") };
  if (action !== "bulk_export" && !SYSTEM_ROLES.includes(payload.role as SystemRole)) return { error: "Choose a role." };
  const [r] = await db.insert(s.approvalRequests).values({ action, payload, reason, requestedById: actor.id }).returning();
  const approvers = (await db.select({ userId: s.systemRoles.userId }).from(s.systemRoles).where(eq(s.systemRoles.role, "system_admin"))).map((x) => x.userId).filter((u) => u !== actor.id);
  await notify(approvers, { type: "security", priority: "important", title: `Approval needed: ${action.replace(/_/g, " ")}`, body: reason, link: "/admin/roles" });
  await audit(actor.id, "approval.requested", { type: "approval", id: r!.id }, { action, ...payload });
  revalidatePath("/admin/roles");
  return { ok: true, message: "Request created. A different administrator must approve it." };
}

export async function decideApprovalAction(form: FormData) {
  const { actor } = await admin();
  const [r] = await db.select().from(s.approvalRequests).where(eq(s.approvalRequests.id, str(form, "id")));
  if (!r || r.status !== "pending" || r.requestedById === actor.id) return; // never approve your own request
  if (!actor.system.has("system_admin") && !actor.isMCP) return;
  const approve = str(form, "op") === "approve";
  await db.update(s.approvalRequests).set({ status: approve ? "approved" : "rejected", decidedById: actor.id, decidedAt: new Date() }).where(eq(s.approvalRequests.id, r.id));
  if (approve && r.action === "grant_system_role") {
    await db.insert(s.systemRoles).values({ userId: r.payload.userId!, role: r.payload.role as SystemRole, grantedById: r.requestedById, approvedById: actor.id }).onConflictDoNothing();
    await db.update(s.approvalRequests).set({ status: "executed" }).where(eq(s.approvalRequests.id, r.id));
  }
  if (approve && r.action === "revoke_system_role") {
    await db.delete(s.systemRoles).where(and(eq(s.systemRoles.userId, r.payload.userId!), eq(s.systemRoles.role, r.payload.role as SystemRole)));
    await db.update(s.approvalRequests).set({ status: "executed" }).where(eq(s.approvalRequests.id, r.id));
  }
  if (approve && r.action === "assign_position") {
    await performAssignment(r.requestedById, r.payload.positionId!, r.payload.userId!, r.payload.startsOn || null);
    await db.update(s.approvalRequests).set({ status: "executed" }).where(eq(s.approvalRequests.id, r.id));
  }
  await notify([r.requestedById], { type: "security", title: `Your request (${r.action.replace(/_/g, " ")}) was ${approve ? "approved" : "rejected"}`, link: "/admin/roles" });
  await audit(actor.id, approve ? "approval.approved" : "approval.rejected", { type: "approval", id: r.id }, { action: r.action, ...r.payload });
  revalidatePath("/admin/roles");
}

// ── Templates ──
export async function saveTemplateAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor } = await requireActor();
  if (!(isAdmin(actor) || actor.system.has("recruitment_admin") || actor.system.has("mx_admin"))) return { error: "Not allowed." };
  const kind = str(form, "kind") as (typeof TEMPLATE_KINDS)[number];
  if (!TEMPLATE_KINDS.includes(kind) || !str(form, "body")) return { error: "Body is required." };
  const [last] = await db.select().from(s.templates).where(eq(s.templates.kind, kind)).orderBy(desc(s.templates.version)).limit(1);
  // Never overwrite: every save is a new version; earlier offers/NDAs keep pointing to the version they used.
  await db.update(s.templates).set({ active: false }).where(eq(s.templates.kind, kind));
  await db.insert(s.templates).values({ kind, name: str(form, "name") || last?.name || kind, version: (last?.version ?? 0) + 1, subject: optStr(form, "subject"), body: str(form, "body"), active: true, createdById: actor.id });
  await audit(actor.id, "template.versioned", { type: "template", id: kind }, { version: (last?.version ?? 0) + 1 });
  revalidatePath("/admin/templates");
  return { ok: true, message: `Saved as version ${(last?.version ?? 0) + 1}. Earlier documents keep their original version.` };
}

// ── Automation ──
export async function runJobsAction(_: FormState): Promise<FormState> {
  const { actor } = await admin();
  const r = await runAll(`manual:${actor.user.name}`);
  revalidatePath("/admin/automation");
  return { ok: true, message: Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(" · ") };
}

export async function saveSettingsAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor } = await admin();
  const nums = (k: string) => str(form, k).split(",").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x >= 0);
  const num = (k: string) => Number(str(form, k));
  const value: Settings = {
    reminderHoursBefore: nums("reminderHoursBefore"),
    escalationDays: { stillOverdue: num("od1"), notifyAssigner: num("od2"), escalate: num("od3"), flag: num("od4") },
    dailyReminderHour: num("dailyReminderHour"), missedUpdatesNotifyLeader: num("missedL1"), missedUpdatesNotifyNextLevel: num("missedL2"),
    weekendDays: nums("weekendDays"), offerReminderHours: nums("offerReminderHours"), offerFinalReminderHours: num("offerFinal"), onboardingGraceDays: num("onboardingGraceDays"),
    documentExpiryWarnDays: nums("documentExpiryWarnDays"),
  };
  const e = value.escalationDays;
  if (!(e.stillOverdue < e.notifyAssigner && e.notifyAssigner < e.escalate && e.escalate < e.flag)) return { error: "Escalation days must increase step by step." };
  if (Object.values(value).some((v) => typeof v === "number" && !Number.isFinite(v))) return { error: "Check the numbers." };
  await saveSettings(value, actor.id);
  await audit(actor.id, "settings.updated", { type: "settings", id: "automation" }, value as unknown as Record<string, unknown>);
  revalidatePath("/admin/automation");
  return { ok: true, message: "Saved." };
}

export async function createRecurringAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor, org } = await requireActor();
  const pos = org.positions.get(str(form, "positionId"));
  if (!pos) return { error: "Choose a position." };
  const { leadsBody } = await import("@/lib/access");
  if (!isAdmin(actor) && !leadsBody(actor, org, pos.bodyId)) return { error: "You can schedule recurring tasks only for positions you lead." };
  const cadence = str(form, "cadence") as "daily" | "weekly" | "monthly";
  await db.insert(s.recurringTasks).values({ title: str(form, "title"), description: optStr(form, "description"), createdById: actor.id, positionId: pos.id, cadence, weekday: cadence === "weekly" ? Number(str(form, "weekday")) : null, dayOfMonth: cadence === "monthly" ? Number(str(form, "dayOfMonth")) || 1 : null, dueHour: Number(str(form, "dueHour")) || 23 });
  revalidatePath("/admin/automation");
  return { ok: true, message: "Recurring task scheduled. It follows the position, so it survives handovers." };
}

export async function toggleRecurringAction(form: FormData) {
  const { actor, org } = await requireActor();
  const [r] = await db.select().from(s.recurringTasks).where(eq(s.recurringTasks.id, str(form, "id")));
  const pos = r ? org.positions.get(r.positionId) : undefined;
  const { leadsBody } = await import("@/lib/access");
  if (!r || !(isAdmin(actor) || r.createdById === actor.id || (pos && leadsBody(actor, org, pos.bodyId)))) return;
  await db.update(s.recurringTasks).set({ active: !r.active }).where(eq(s.recurringTasks.id, r.id));
  revalidatePath("/admin/automation");
}
