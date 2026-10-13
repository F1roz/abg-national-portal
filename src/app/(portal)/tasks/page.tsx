import Link from "next/link";
import { and, asc, desc, eq, inArray, ne, notInArray } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { usersInSubtree } from "@/lib/access";
import { taskHealth } from "@/lib/insights";
import { usersByIds } from "@/lib/org";
import { Card, Empty, PageHeader, PriorityBadge, Stat, StatusBadge, Tabs } from "@/components/ui";
import { fmtDateTime, relTime } from "@/lib/util";

export const metadata = { title: "Tasks" };

type Search = { view?: string; filter?: string };

export default async function TasksPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { actor, org } = await requireActor();
  const { view = "mine", filter = "open" } = await searchParams;
  const now = new Date();

  const teamIds = [...new Set([...actor.ledBodyIds].flatMap((b) => [...usersInSubtree(org, b)]))].filter((u) => u !== actor.id);
  const base = [eq(s.tasks.termId, org.termId)];
  if (view === "assigned") base.push(eq(s.tasks.createdById, actor.id), ne(s.tasks.assigneeId, actor.id));
  else if (view === "team") base.push(teamIds.length ? inArray(s.tasks.assigneeId, teamIds) : eq(s.tasks.id, "00000000-0000-0000-0000-000000000000"));
  else base.push(eq(s.tasks.assigneeId, actor.id));

  if (filter === "open") base.push(notInArray(s.tasks.status, ["completed", "rejected"]));
  else if (filter === "review") base.push(eq(s.tasks.status, "submitted"));
  else if (filter === "blocked") base.push(eq(s.tasks.status, "blocked"));
  else if (filter === "completed") base.push(eq(s.tasks.status, "completed"));

  let rows = await db.select().from(s.tasks).where(and(...base)).orderBy(asc(s.tasks.dueAt), desc(s.tasks.createdAt)).limit(300);
  if (filter === "overdue") rows = rows.filter((t) => t.dueAt && t.dueAt < now && !["completed", "rejected"].includes(t.status));
  const people = await usersByIds(rows.flatMap((t) => [t.assigneeId, t.createdById]));

  const health = view === "assigned" ? await taskHealth({ createdById: actor.id }, org.termId) : view === "team" ? await taskHealth({ assigneeIds: teamIds }, org.termId) : await taskHealth({ assigneeIds: [actor.id] }, org.termId);
  const tab = (v: string) => `/tasks?view=${v}&filter=${filter}`;
  const fl = (f: string) => `/tasks?view=${view}&filter=${f}`;

  // Assigned-by summary for "My tasks"
  const byAssigner = new Map<string, number>();
  if (view === "mine") for (const t of rows) if (t.createdById !== actor.id) byAssigner.set(t.createdById, (byAssigner.get(t.createdById) ?? 0) + 1);

  return (
    <>
      <PageHeader title="Tasks" subtitle="Hierarchical work: who expects what from whom, with a full activity trail." actions={<Link href="/tasks/new" className="btn-primary">➕ New task</Link>} />
      <Tabs
        active={view}
        tabs={[
          { key: "mine", label: "My tasks", href: tab("mine") },
          { key: "assigned", label: "Assigned by me", href: tab("assigned") },
          ...(actor.isLeader ? [{ key: "team", label: "My team's tasks", href: tab("team") }] : []),
        ]}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="On time" value={health.onTimePct === null ? "—" : `${health.onTimePct}%`} hint="of completed with a deadline" />
        <Stat label="Completed" value={`🟢 ${health.completed}`} />
        <Stat label="In progress" value={`🟡 ${health.inProgress}`} />
        <Stat label="Overdue" value={`🔴 ${health.overdue}`} tone={health.overdue ? "red" : undefined} />
        <Stat label="Blocked / review" value={`⚠️ ${health.blocked} · 🟣 ${health.review}`} />
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5 text-sm">
        {["open", "overdue", "review", "blocked", "completed", "all"].map((f) => (
          <Link key={f} href={fl(f)} className={`rounded-full px-3 py-1 ${f === filter ? "bg-brand text-white" : "bg-white text-gray-600 ring-1 ring-gray-200"}`}>{f[0]!.toUpperCase() + f.slice(1)}</Link>
        ))}
      </div>
      {view === "mine" && byAssigner.size ? (
        <div className="mb-3 text-sm text-gray-600">Assigned by: {[...byAssigner.entries()].map(([u, n]) => `${people.get(u)?.name} — ${n}`).join(" · ")}</div>
      ) : null}
      <Card bodyClass="p-0">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Task</th><th>{view === "mine" ? "Assigned by" : "Assignee"}</th><th>Deadline</th><th>Priority</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((t) => {
                  const late = t.dueAt && t.dueAt < now && !["completed", "rejected"].includes(t.status);
                  return (
                    <tr key={t.id} className={late ? "bg-red-50/40" : ""}>
                      <td>
                        <Link href={`/tasks/${t.id}`} className="font-medium hover:underline">{t.title}</Link>
                        {t.requireAck && !t.acknowledgedAt ? <span className="ml-2 text-xs text-red-600">needs acknowledgement</span> : null}
                        {t.kpiId ? <span className="ml-2 text-xs text-brand">KPI-linked</span> : null}
                      </td>
                      <td className="whitespace-nowrap">{people.get(view === "mine" ? t.createdById : t.assigneeId)?.name}</td>
                      <td className={`whitespace-nowrap ${late ? "font-semibold text-red-600" : ""}`}>{t.dueAt ? `${fmtDateTime(t.dueAt)} (${relTime(t.dueAt)})` : "—"}</td>
                      <td><PriorityBadge priority={t.priority} /></td>
                      <td><StatusBadge status={t.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4"><Empty>No tasks here.</Empty></div>
        )}
      </Card>
    </>
  );
}
