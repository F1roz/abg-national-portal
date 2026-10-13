/** Aggregations behind dashboards, the reporting view and the MC command center. */
import { and, eq, gte, inArray, isNull, lt, ne, notInArray, or } from "drizzle-orm";
import { db, s } from "@/db";
import { subtreeOf, usersInSubtree, type Org } from "./access";
import { averageAchievement, withActuals } from "./kpi";
import { addDays, localDate } from "./util";

const OPEN: ("not_started" | "in_progress" | "blocked" | "submitted")[] = ["not_started", "in_progress", "blocked", "submitted"];

export type TaskHealth = { total: number; completed: number; inProgress: number; overdue: number; blocked: number; review: number; onTimePct: number | null };

export async function taskHealth(where: { assigneeIds?: string[]; createdById?: string; bodyIds?: string[] }, termId: string): Promise<TaskHealth> {
  const conds = [eq(s.tasks.termId, termId)];
  if (where.assigneeIds) {
    if (!where.assigneeIds.length) return { total: 0, completed: 0, inProgress: 0, overdue: 0, blocked: 0, review: 0, onTimePct: null };
    conds.push(inArray(s.tasks.assigneeId, where.assigneeIds));
  }
  if (where.createdById) conds.push(eq(s.tasks.createdById, where.createdById), ne(s.tasks.assigneeId, where.createdById));
  if (where.bodyIds) conds.push(inArray(s.tasks.bodyId, where.bodyIds));
  const rows = await db.select({ status: s.tasks.status, dueAt: s.tasks.dueAt, completedAt: s.tasks.completedAt }).from(s.tasks).where(and(...conds));
  const now = new Date();
  const completed = rows.filter((r) => r.status === "completed");
  const withDue = completed.filter((r) => r.dueAt);
  return {
    total: rows.length,
    completed: completed.length,
    inProgress: rows.filter((r) => r.status === "in_progress").length,
    overdue: rows.filter((r) => OPEN.includes(r.status as (typeof OPEN)[number]) && r.dueAt && r.dueAt < now).length,
    blocked: rows.filter((r) => r.status === "blocked").length,
    review: rows.filter((r) => r.status === "submitted").length,
    onTimePct: withDue.length ? Math.round((withDue.filter((r) => r.completedAt && r.completedAt <= r.dueAt!).length / withDue.length) * 100) : null,
  };
}

export type ReportingRow = { userId: string; checkedIn: Date | null; dailyDone: boolean; missedDays: number; openTasks: number; overdueTasks: number; completionPct: number | null };

/** Reporting status per person for `date`, with missed daily updates over the previous 7 days. */
export async function reportingFor(userIds: string[], termId: string, date = localDate()): Promise<ReportingRow[]> {
  if (!userIds.length) return [];
  const weekAgo = addDays(date, -7);
  const [att, updates, tasks] = await Promise.all([
    db.select({ userId: s.attendance.userId, at: s.attendance.checkInAt }).from(s.attendance).where(and(inArray(s.attendance.userId, userIds), eq(s.attendance.date, date))),
    db.select({ userId: s.dailyUpdates.userId, date: s.dailyUpdates.date }).from(s.dailyUpdates).where(and(inArray(s.dailyUpdates.userId, userIds), gte(s.dailyUpdates.date, weekAgo))),
    db.select({ assigneeId: s.tasks.assigneeId, status: s.tasks.status, dueAt: s.tasks.dueAt }).from(s.tasks).where(and(inArray(s.tasks.assigneeId, userIds), eq(s.tasks.termId, termId))),
  ]);
  const now = new Date();
  return userIds.map((u) => {
    const mine = tasks.filter((t) => t.assigneeId === u);
    const days = new Set(updates.filter((x) => x.userId === u).map((x) => x.date));
    let missed = 0;
    for (let i = 1; i <= 7; i++) if (!days.has(addDays(date, -i))) missed++;
    const done = mine.filter((t) => t.status === "completed").length;
    return {
      userId: u,
      checkedIn: att.find((a) => a.userId === u)?.at ?? null,
      dailyDone: days.has(date),
      missedDays: missed,
      openTasks: mine.filter((t) => OPEN.includes(t.status as (typeof OPEN)[number])).length,
      overdueTasks: mine.filter((t) => OPEN.includes(t.status as (typeof OPEN)[number]) && t.dueAt && t.dueAt < now).length,
      completionPct: mine.length ? Math.round((done / mine.length) * 100) : null,
    };
  });
}

export type BodyHealth = {
  bodyId: string;
  kpi: number | null;
  reporting: number | null;
  tasks: number | null;
  score: number | null;
  members: number;
};

/**
 * Health score = average of the available components (each 0–100):
 *   KPI achievement (capped), daily-update reporting rate over 7 days, task on-time/non-overdue rate.
 * It is a decision-support signal, not a verdict.
 */
export async function bodyHealth(org: Org, bodyId: string): Promise<BodyHealth> {
  const bodies = [...subtreeOf(org, bodyId)];
  const users = [...usersInSubtree(org, bodyId)];
  const kpiRows = await db.select().from(s.kpis).where(and(inArray(s.kpis.bodyId, bodies), isNull(s.kpis.userId)));
  const kpi = averageAchievement(await withActuals(kpiRows));
  const rep = await reportingFor(users, org.termId);
  const reporting = rep.length ? Math.round((rep.reduce((a, r) => a + (7 - r.missedDays), 0) / (rep.length * 7)) * 100) : null;
  const th = await taskHealth({ assigneeIds: users }, org.termId);
  const tasks = th.total ? Math.round(((th.total - th.overdue) / th.total) * 100) : null;
  const parts = [kpi === null ? null : Math.min(kpi, 100), reporting, tasks].filter((x): x is number => x !== null);
  return { bodyId, kpi, reporting, tasks, score: parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null, members: users.length };
}

export type Attention = { level: "red" | "orange"; title: string; detail: string; link?: string };

/** Early-warning list for a leader's scope. */
export async function attentionFor(org: Org, bodyIds: string[], termId: string): Promise<Attention[]> {
  const out: Attention[] = [];
  const scopeBodies = new Set(bodyIds.flatMap((b) => [...subtreeOf(org, b)]));
  const users = new Set(bodyIds.flatMap((b) => [...usersInSubtree(org, b)]));

  // People not reporting for 3+ of the last 7 days
  const rep = await reportingFor([...users], termId);
  const names = new Map((users.size ? await db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, [...users])) : []).map((u) => [u.id, u.name]));
  const silent = rep.filter((x) => x.missedDays >= 3).sort((a, b) => b.missedDays - a.missedDays);
  if (silent.length > 4) {
    out.push({
      level: silent.length / Math.max(rep.length, 1) > 0.3 ? "red" : "orange",
      title: `${silent.length} of ${rep.length} people missed 3+ daily updates in the last 7 days`,
      detail: `Including ${silent.slice(0, 4).map((r) => names.get(r.userId)).join(", ")}. Check whether reporting is understood and supported.`,
      link: "/reporting",
    });
  } else {
    for (const r of silent) {
      out.push({ level: r.missedDays >= 5 ? "red" : "orange", title: `${names.get(r.userId)} hasn't reported for ${r.missedDays} of the last 7 days`, detail: "A check-in conversation may help — ask if support is needed.", link: `/people/${r.userId}` });
    }
  }

  // Overdue and blocked tasks in scope
  const now = new Date();
  if (users.size) {
    const late = await db
      .select({ id: s.tasks.id, title: s.tasks.title, assigneeId: s.tasks.assigneeId, dueAt: s.tasks.dueAt, status: s.tasks.status })
      .from(s.tasks)
      .where(and(eq(s.tasks.termId, termId), inArray(s.tasks.assigneeId, [...users]), notInArray(s.tasks.status, ["completed", "rejected"]), or(lt(s.tasks.dueAt, now), eq(s.tasks.status, "blocked"))))
      .limit(30);
    for (const t of late.slice(0, 10)) {
      out.push({
        level: t.status === "blocked" ? "orange" : "red",
        title: t.status === "blocked" ? `Blocked: ${t.title}` : `Overdue: ${t.title}`,
        detail: `${names.get(t.assigneeId) ?? "Someone"}${t.dueAt ? ` · due ${t.dueAt.toISOString().slice(0, 10)}` : ""}`,
        link: `/tasks/${t.id}`,
      });
    }
  }

  // KPIs far below the expected pace (term elapsed share)
  const [term] = await db.select().from(s.terms).where(eq(s.terms.id, termId));
  if (term) {
    const start = new Date(`${term.startsOn}T00:00:00Z`).getTime();
    const end = new Date(`${term.endsOn}T00:00:00Z`).getTime();
    const elapsed = Math.max(0.05, Math.min(1, (Date.now() - start) / (end - start)));
    const kpiRows = scopeBodies.size ? await db.select().from(s.kpis).where(and(inArray(s.kpis.bodyId, [...scopeBodies]), isNull(s.kpis.userId))) : [];
    for (const k of await withActuals(kpiRows)) {
      const pace = k.target ? k.actual / (k.target * elapsed) : 1;
      if (pace < 0.6) {
        const body = org.bodies.get(k.bodyId);
        out.push({ level: pace < 0.35 ? "red" : "orange", title: `${body?.shortName ?? body?.name}: ${k.name} at ${Math.round(pace * 100)}% of expected pace`, detail: `${k.actual} of ${k.target} with ${Math.round(elapsed * 100)}% of the term elapsed`, link: `/bodies/${k.bodyId}` });
      }
    }
  }

  // Overdue finance receivables in visible FNL trackers
  const fnl = [...scopeBodies].filter((b) => org.bodies.get(b)?.departmentKey === "FNL");
  if (fnl.length) {
    const trackers = await db.select({ id: s.trackers.id, bodyId: s.trackers.bodyId }).from(s.trackers).where(inArray(s.trackers.bodyId, fnl));
    if (trackers.length) {
      const rows = await db.select().from(s.trackerRows).where(inArray(s.trackerRows.trackerId, trackers.map((t) => t.id)));
      const overdue = rows.filter((r) => r.data.status === "Overdue");
      if (overdue.length) {
        const total = overdue.reduce((a, r) => a + (Number(r.data.amount) || 0), 0);
        out.push({ level: "red", title: `FNL: ${overdue.length} overdue receivable(s)`, detail: `৳ ${total.toLocaleString("en-IN")} outstanding`, link: `/trackers/${trackers[0]!.id}` });
      }
    }
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "red" ? -1 : 1));
}
