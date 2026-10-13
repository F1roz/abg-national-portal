/**
 * Automation engine — run every 15 minutes (cron → POST /api/cron, or `npm run jobs`).
 * Every step is idempotent: notifications carry dedupe keys, recurring tasks record the day generated.
 *
 * Philosophy: Detect → Remind → Support → Escalate → Review. Nothing here penalises anyone automatically.
 */
import { and, eq, gte, inArray, isNotNull, lte, notInArray } from "drizzle-orm";
import { db, s } from "@/db";
import { supervisorChain, type Org } from "@/lib/access";
import { deliverOutbox, emailLayout, queueEmail } from "@/lib/email";
import { tallyMotion } from "@/lib/governance";
import { notify } from "@/lib/notify";
import { loadOrgData } from "@/lib/org";
import { activeTemplate, candidateVars, setCandidateStatus } from "@/lib/recruitment";
import { getSettings, type Settings } from "@/lib/settings";
import { createTask, logTask } from "@/lib/tasks";
import { plainSubject, renderTemplate } from "@/lib/templates";
import { addDays, fmtDate, localDate, tzOffsetMinutes } from "@/lib/util";

const HOUR = 3_600_000;

function localHour(now: Date): number {
  return new Date(now.getTime() + tzOffsetMinutes(now) * 60_000).getUTCHours();
}
function weekday(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}
function isoWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return `${d.getUTCFullYear()}-W${String(1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)).padStart(2, "0")}`;
}
/** Local midnight → UTC instant, then add hour. */
function localDateAt(dateStr: string, hour: number): Date {
  const noon = new Date(`${dateStr}T12:00:00Z`);
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) - tzOffsetMinutes(noon) * 60_000 + hour * HOUR);
}

// 1. Recurring tasks ─────────────────────────────────────────────
export async function generateRecurringTasks(org: Org, now = new Date()) {
  const today = localDate(now);
  const rows = await db.select().from(s.recurringTasks).where(eq(s.recurringTasks.active, true));
  let created = 0;
  for (const r of rows) {
    if (r.lastGeneratedOn === today) continue;
    const dow = weekday(today);
    const dom = Number(today.slice(8, 10));
    const due = r.cadence === "daily" || (r.cadence === "weekly" && r.weekday === dow) || (r.cadence === "monthly" && (r.dayOfMonth ?? 1) === dom);
    if (!due) continue;
    const holders = org.holders.get(r.positionId) ?? [];
    const [creator] = await db.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, r.createdById));
    for (const userId of holders) {
      await createTask(org, r.createdById, { title: `${r.title} — ${fmtDate(today)}`, description: r.description, assigneeId: userId, dueAt: localDateAt(today, r.dueHour), priority: r.priority, category: "report", recurringId: r.id }, { creatorName: creator?.name ?? "Recurring schedule", skipPermission: true });
      created++;
    }
    await db.update(s.recurringTasks).set({ lastGeneratedOn: today }).where(eq(s.recurringTasks.id, r.id));
  }
  return created;
}

// 2. Task reminders & escalation ─────────────────────────────────
type Stage = { key: string; at: number };

export function taskStages(due: Date, cfg: Settings): Stage[] {
  const t = due.getTime();
  const before = [...cfg.reminderHoursBefore].sort((a, b) => b - a).map((h) => ({ key: `b${h}h`, at: t - h * HOUR }));
  const e = cfg.escalationDays;
  return [
    ...before,
    { key: "due", at: t },
    { key: `od${e.stillOverdue}`, at: t + e.stillOverdue * 24 * HOUR },
    { key: `od${e.notifyAssigner}`, at: t + e.notifyAssigner * 24 * HOUR },
    { key: `od${e.escalate}`, at: t + e.escalate * 24 * HOUR },
    { key: `od${e.flag}`, at: t + e.flag * 24 * HOUR },
  ];
}

/** Returns the most recent stage that is due and not yet sent (a late run never sends a burst of stale reminders). */
export function nextStage(due: Date, sentKey: string | null, now: Date, cfg: Settings): Stage | null {
  const stages = taskStages(due, cfg);
  const sentIdx = sentKey ? stages.findIndex((x) => x.key === sentKey) : -1;
  let pick = -1;
  stages.forEach((st, i) => {
    if (st.at <= now.getTime() && i > sentIdx) pick = i;
  });
  return pick === -1 ? null : stages[pick]!;
}

export async function taskReminders(org: Org, now = new Date()) {
  const cfg = await getSettings();
  const open = await db.select().from(s.tasks).where(and(isNotNull(s.tasks.dueAt), notInArray(s.tasks.status, ["completed", "rejected", "submitted"]), eq(s.tasks.termId, org.termId)));
  const names = new Map((await db.select({ id: s.users.id, name: s.users.name }).from(s.users)).map((u) => [u.id, u.name]));
  let sent = 0;
  const e = cfg.escalationDays;
  for (const t of open) {
    const st = nextStage(t.dueAt!, t.reminderStage, now, cfg);
    if (!st) continue;
    const link = `/tasks/${t.id}`;
    const dk = `task:${t.id}:${st.key}`;
    const who = names.get(t.assigneeId) ?? "Someone";
    if (st.key.startsWith("b")) {
      // Label from the real time left (the task may have been created after an earlier stage's time).
      const hours = Math.max(1, Math.round((t.dueAt!.getTime() - now.getTime()) / HOUR));
      const label = hours >= 48 ? `in ${Math.round(hours / 24)} days` : `in ${hours} hours`;
      sent += await notify([t.assigneeId], { type: "task_reminder", priority: hours <= 3 ? "important" : "normal", title: `${hours <= 3 ? "🔴" : hours <= 24 ? "⚠️" : "📅"} Task due ${label}: ${t.title}`, link, dedupeKey: dk });
    } else if (st.key === "due") {
      sent += await notify([t.assigneeId], { type: "task_overdue", priority: "important", title: `🚨 Deadline passed: ${t.title}`, body: "Update the status, submit, or ask for an extension.", link, dedupeKey: dk });
    } else {
      const days = Number(st.key.slice(2));
      if (days === e.stillOverdue) {
        sent += await notify([t.assigneeId], { type: "task_overdue", priority: "important", title: `Your task is overdue by ${days} day${days > 1 ? "s" : ""}: ${t.title}`, body: "Please update the status — mark it blocked if something is in your way.", link, dedupeKey: dk });
      } else if (days === e.notifyAssigner) {
        if (t.createdById !== t.assigneeId) sent += await notify([t.createdById], { type: "escalation", priority: "important", title: `🔴 ${who} has an overdue task you assigned: ${t.title}`, body: `${days} days overdue.`, link, dedupeKey: dk });
      } else if (days === e.escalate || days === e.flag) {
        const level = days === e.escalate ? 0 : 1;
        const chain = supervisorChain(org, t.assigneeId).flat().filter((u) => u !== t.assigneeId && u !== t.createdById);
        const target = chain.slice(level, level + 1);
        sent += await notify(target, {
          type: "escalation", priority: days === e.flag ? "critical" : "important",
          title: days === e.flag ? `Support flag: "${t.title}" (${who}) is ${days} days overdue` : `🔴 Task escalation: "${t.title}" remains incomplete (${who})`,
          body: "This is a prompt to check in and offer support — not an automatic penalty.", link, dedupeKey: dk,
        });
        await db.update(s.tasks).set({ escalationLevel: t.escalationLevel + 1 }).where(eq(s.tasks.id, t.id));
        await logTask(t.id, null, "escalated", `Automatically escalated (${days} days overdue)`);
      }
    }
    await db.update(s.tasks).set({ reminderStage: st.key }).where(eq(s.tasks.id, t.id));
  }
  return sent;
}

// 3. Daily update reminders & pattern detection ──────────────────
export async function dailyUpdateReminders(org: Org, now = new Date()) {
  const cfg = await getSettings();
  const today = localDate(now);
  let sent = 0;
  const users = [...org.userPositions.keys()];
  if (!users.length) return 0;
  const active = new Set((await db.select({ id: s.users.id }).from(s.users).where(and(inArray(s.users.id, users), eq(s.users.status, "active")))).map((u) => u.id));
  const weekAgo = addDays(today, -7);
  const updates = await db.select({ userId: s.dailyUpdates.userId, date: s.dailyUpdates.date }).from(s.dailyUpdates).where(and(inArray(s.dailyUpdates.userId, users), gte(s.dailyUpdates.date, weekAgo)));
  const leave = await db.select().from(s.leaveRequests).where(and(eq(s.leaveRequests.status, "approved"), lte(s.leaveRequests.startDate, today), gte(s.leaveRequests.endDate, weekAgo)));
  const onLeave = (u: string, d: string) => leave.some((l) => l.userId === u && l.startDate <= d && l.endDate >= d);
  const expected = (d: string) => !cfg.weekendDays.includes(weekday(d));

  for (const u of active) {
    const done = new Set(updates.filter((x) => x.userId === u).map((x) => x.date));
    // Evening reminder for today
    if (localHour(now) >= cfg.dailyReminderHour && expected(today) && !onLeave(u, today) && !done.has(today)) {
      sent += await notify([u], { type: "daily_update", priority: "normal", title: "📝 You haven't submitted today's update", body: "Two minutes — what you did, what's blocking you, what you need.", link: "/daily", dedupeKey: `daily:${today}` });
    }
    // Pattern over the previous 7 days (excluding today, weekends and leave)
    let missed = 0;
    for (let i = 1; i <= 7; i++) {
      const d = addDays(today, -i);
      if (expected(d) && !onLeave(u, d) && !done.has(d)) missed++;
    }
    if (missed >= cfg.missedUpdatesNotifyLeader) {
      const week = isoWeek(today);
      sent += await notify([u], { type: "daily_update", priority: "important", title: `You have missed ${missed} daily updates this week`, body: "Is anything getting in the way? Your leader can help.", link: "/daily", dedupeKey: `pattern-self:${week}` });
      const chain = supervisorChain(org, u);
      const [name] = await db.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, u));
      sent += await notify(chain[0] ?? [], { type: "daily_update", priority: "important", title: `${name?.name} hasn't reported ${missed} times in the last 7 days`, body: "A check-in conversation may help — ask if support is needed.", link: `/people/${u}`, dedupeKey: `pattern-l1:${u}:${week}` });
      if (missed >= cfg.missedUpdatesNotifyNextLevel) {
        sent += await notify(chain[1] ?? [], { type: "daily_update", priority: "normal", title: `Reporting pattern: ${name?.name} missed ${missed} of 7 days`, body: "Their direct leader has been informed.", link: "/reporting", dedupeKey: `pattern-l2:${u}:${week}` });
      }
    }
  }
  return sent;
}

// 4. Offers: reminders and expiry ────────────────────────────────
export async function offerAutomation(org: Org, now = new Date()) {
  const cfg = await getSettings();
  const open = await db.select().from(s.offers).where(inArray(s.offers.status, ["sent", "viewed"]));
  let n = 0;
  const recruiters = (await db.select({ userId: s.systemRoles.userId }).from(s.systemRoles).where(eq(s.systemRoles.role, "recruitment_admin"))).map((r) => r.userId);
  for (const o of open) {
    const [c] = await db.select().from(s.candidates).where(eq(s.candidates.id, o.candidateId));
    if (!c) continue;
    if (o.expiresAt <= now) {
      await db.update(s.offers).set({ status: "expired" }).where(eq(s.offers.id, o.id));
      await setCandidateStatus(c.id, "offer_expired", null, o.code);
      await notify([...recruiters, ...(c.reportingUserId ? [c.reportingUserId] : [])], { type: "onboarding", priority: "important", title: `Offer ${o.code} for ${c.fullName} expired without a response`, link: `/recruitment/${c.id}`, dedupeKey: `offer-exp:${o.id}` });
      n++;
      continue;
    }
    const since = (now.getTime() - (o.sentAt ?? o.createdAt).getTime()) / HOUR;
    const untilExpiry = (o.expiresAt.getTime() - now.getTime()) / HOUR;
    const final = untilExpiry <= cfg.offerFinalReminderHours && o.remindersSent < cfg.offerReminderHours.length + 1;
    const regular = o.remindersSent < cfg.offerReminderHours.length && since >= cfg.offerReminderHours[o.remindersSent]!;
    if (!final && !regular) continue;
    // A reminder cannot contain the link (only its hash is stored); it points the candidate back to the original email.
    const tpl = await activeTemplate("email_offer_reminder");
    const vars = await candidateVars(org, c, { offer_id: o.code });
    const subject = final ? "⚠️ Final reminder — your AIESEC Bangladesh offer expires soon" : plainSubject(tpl?.subject ?? "Reminder — your offer letter is waiting", vars);
    await queueEmail(c.email, subject, emailLayout({ title: subject, contentHtml: `${renderTemplate(tpl?.body ?? "Dear {{candidate_name}}, your offer is waiting.", vars)}<p>Open the original offer email from us and use the <strong>VIEW &amp; ACCEPT OFFER LETTER</strong> button. If you can't find it, reply to the recruitment team and we'll resend it.</p>`, footerNote: `Offer ${o.code}` }));
    await db.update(s.offers).set({ remindersSent: final ? cfg.offerReminderHours.length + 1 : o.remindersSent + 1 }).where(eq(s.offers.id, o.id));
    n++;
  }
  return n;
}

// 5. Onboarding not completed in time ────────────────────────────
export async function onboardingAlerts(org: Org, now = new Date()) {
  const cfg = await getSettings();
  const today = localDate(now);
  const cands = await db.select().from(s.candidates).where(inArray(s.candidates.status, ["account_created", "account_activated", "onboarding_in_progress"]));
  let n = 0;
  for (const c of cands) {
    if (!c.userId || !c.startDate || addDays(c.startDate, cfg.onboardingGraceDays) > today) continue;
    const items = await db.select().from(s.onboardingItems).where(eq(s.onboardingItems.userId, c.userId));
    const open = items.filter((i) => i.required && !i.doneAt);
    if (!open.length) continue;
    const week = isoWeek(today);
    n += await notify([c.userId], { type: "onboarding", priority: "important", title: `⚠️ Onboarding incomplete — ${open.length} step(s) left`, body: open.map((i) => i.label).slice(0, 4).join(", "), link: "/onboarding", dedupeKey: `onb:${c.userId}:${week}` });
    const chain = supervisorChain(org, c.userId);
    n += await notify([...(c.reportingUserId ? [c.reportingUserId] : []), ...(chain[0] ?? [])], { type: "onboarding", priority: "normal", title: `${c.fullName}'s onboarding is incomplete (${open.length} left)`, body: "Check whether they need support.", link: `/people/${c.userId}`, dedupeKey: `onb-l:${c.userId}:${week}` });
  }
  return n;
}

// 6. Governance motions past their closing time ──────────────────
export async function closeMotions(org: Org, now = new Date()) {
  const due = await db.select().from(s.motions).where(and(eq(s.motions.status, "open"), lte(s.motions.closesAt, now)));
  for (const m of due) await tallyMotion(org, m.id, null);
  return due.length;
}

// 7. Expiring documents (MoUs, contracts) ────────────────────────
export async function documentExpiry(now = new Date()) {
  const cfg = await getSettings();
  const today = localDate(now);
  const docs = await db.select().from(s.documents).where(and(isNotNull(s.documents.expiresOn), gte(s.documents.expiresOn, today)));
  let n = 0;
  for (const d of docs) {
    if (!d.ownerId) continue;
    for (const days of cfg.documentExpiryWarnDays) {
      if (d.expiresOn! <= addDays(today, days)) {
        n += await notify([d.ownerId], { type: "system", priority: days <= 7 ? "important" : "normal", title: `📄 “${d.title}” expires on ${fmtDate(d.expiresOn)}`, body: "Plan the renewal with the partner.", link: "/documents", dedupeKey: `docexp:${d.id}:${days}` });
        break;
      }
    }
  }
  return n;
}

// 8. Personal weekly summary (Sunday) ────────────────────────────
export async function weeklySummaries(org: Org, now = new Date()) {
  const today = localDate(now);
  if (weekday(today) !== 0 || localHour(now) < 18) return 0;
  const since = new Date(now.getTime() - 7 * 24 * HOUR);
  const users = [...org.userPositions.keys()];
  let n = 0;
  for (const u of users) {
    const [done, overdue, updates, recog] = await Promise.all([
      db.select({ id: s.tasks.id }).from(s.tasks).where(and(eq(s.tasks.assigneeId, u), eq(s.tasks.status, "completed"), gte(s.tasks.completedAt, since))),
      db.select({ id: s.tasks.id }).from(s.tasks).where(and(eq(s.tasks.assigneeId, u), notInArray(s.tasks.status, ["completed", "rejected"]), lte(s.tasks.dueAt, now))),
      db.select({ id: s.dailyUpdates.id }).from(s.dailyUpdates).where(and(eq(s.dailyUpdates.userId, u), gte(s.dailyUpdates.date, addDays(today, -7)))),
      db.select({ id: s.recognitions.id }).from(s.recognitions).where(and(eq(s.recognitions.toId, u), gte(s.recognitions.createdAt, since))),
    ]);
    const hint = overdue.length > 2 ? "Focus next week: clear your overdue tasks or ask for extensions." : updates.length < 4 ? "Focus next week: reporting consistency." : "Great consistency — keep it up!";
    n += await notify([u], { type: "system", priority: "info", title: `📊 Your week: ${done.length} tasks done · ${overdue.length} overdue · ${updates.length} daily updates · ${recog.length} recognitions`, body: hint, link: "/dashboard", dedupeKey: `weekly:${isoWeek(today)}` });
  }
  return n;
}

export async function runAll(trigger = "manual"): Promise<Record<string, number | string>> {
  const started = new Date();
  const org = await loadOrgData();
  const result: Record<string, number | string> = {};
  const steps: [string, () => Promise<number | { sent: number; logged: number; failed: number }>][] = [
    ["recurringTasks", () => generateRecurringTasks(org)],
    ["taskReminders", () => taskReminders(org)],
    ["dailyUpdateReminders", () => dailyUpdateReminders(org)],
    ["offers", () => offerAutomation(org)],
    ["onboarding", () => onboardingAlerts(org)],
    ["motions", () => closeMotions(org)],
    ["documentExpiry", () => documentExpiry()],
    ["weeklySummaries", () => weeklySummaries(org)],
    ["emails", () => deliverOutbox(200)],
  ];
  for (const [name, fn] of steps) {
    try {
      const r = await fn();
      result[name] = typeof r === "number" ? r : `${r.sent} sent, ${r.logged} logged, ${r.failed} failed`;
    } catch (e) {
      result[name] = `error: ${(e as Error).message}`.slice(0, 200);
    }
  }
  await db.insert(s.jobRuns).values({ trigger, result, startedAt: started, finishedAt: new Date() });
  return result;
}

