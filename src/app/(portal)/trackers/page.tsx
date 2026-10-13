import Link from "next/link";
import { eq, inArray, sql as dsql } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { canViewBodyWork, leadsBody } from "@/lib/access";
import { applyRollup } from "@/lib/kpi";
import { bodyPath } from "@/lib/org";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/util";

export const metadata = { title: "Trackers" };

export default async function TrackersPage({ searchParams }: { searchParams: Promise<{ scope?: string; q?: string }> }) {
  const { actor, org } = await requireActor();
  const { scope = "mine", q = "" } = await searchParams;
  const all = await db.select().from(s.trackers).where(eq(s.trackers.termId, org.termId));
  const visible = all.filter((t) => canViewBodyWork(actor, org, t.bodyId));
  const mine = visible.filter((t) => actor.memberBodyIds.has(t.bodyId));
  const led = visible.filter((t) => !actor.memberBodyIds.has(t.bodyId) && leadsBody(actor, org, t.bodyId));
  const linked = visible.filter((t) => !mine.includes(t) && !led.includes(t) && !actor.isMC);
  const rest = visible.filter((t) => !mine.includes(t) && !led.includes(t) && !linked.includes(t));
  const filterText = (list: typeof visible) => (q ? list.filter((t) => `${t.name} ${bodyPath(org, t.bodyId)}`.toLowerCase().includes(q.toLowerCase())) : list);

  const ids = visible.map((t) => t.id);
  const counts = ids.length
    ? await db.select({ trackerId: s.trackerRows.trackerId, n: dsql<number>`count(*)::int`, last: dsql<Date>`max(${s.trackerRows.updatedAt})` }).from(s.trackerRows).where(inArray(s.trackerRows.trackerId, ids)).groupBy(s.trackerRows.trackerId)
    : [];
  const countMap = new Map(counts.map((c) => [c.trackerId, c]));
  const rollupRows = ids.length ? await db.select({ trackerId: s.trackerRows.trackerId, data: s.trackerRows.data }).from(s.trackerRows).where(inArray(s.trackerRows.trackerId, ids)) : [];

  // Group the MC's entity-wide view by LC / MC / other
  const groupOf = (bodyId: string) => {
    let cur = org.bodies.get(bodyId);
    while (cur && cur.type !== "lc" && cur.type !== "mc" && cur.parentId) cur = org.bodies.get(cur.parentId);
    return cur?.type === "lc" || cur?.type === "mc" ? cur.name : "Entity";
  };

  const List = ({ list }: { list: typeof visible }) =>
    list.length ? (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((t) => {
          const c = countMap.get(t.id);
          const rows = rollupRows.filter((r) => r.trackerId === t.id);
          return (
            <Link key={t.id} href={`/trackers/${t.id}`} className="card block p-4 transition hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold">{t.name}</div>
                {org.bodies.get(t.bodyId)?.type ? <Badge tone="blue">{org.bodies.get(t.bodyId)!.type}</Badge> : null}
              </div>
              <div className="text-xs text-gray-500">{bodyPath(org, t.bodyId)}</div>
              <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-gray-600">
                <span>{c?.n ?? 0} rows</span>
                {t.rollups.slice(0, 2).map((r, i) => <span key={i}>{r.label}: <strong>{applyRollup(rows, r).toLocaleString("en-IN")}</strong></span>)}
                {c?.last ? <span>updated {fmtDate(new Date(c.last))}</span> : null}
              </div>
            </Link>
          );
        })}
      </div>
    ) : <Empty>No trackers.</Empty>;

  const grouped = new Map<string, typeof visible>();
  for (const t of filterText(rest)) grouped.set(groupOf(t.bodyId), [...(grouped.get(groupOf(t.bodyId)) ?? []), t]);

  return (
    <>
      <PageHeader
        title="Trackers"
        subtitle={actor.isMC ? `Every department, team, OC, project and synergy team has a tracker. As MC you can read all ${visible.length}.` : "Trackers of your teams, and of every team you lead."}
      />
      <form className="mb-4"><input name="q" defaultValue={q} placeholder="Filter by name, LC or department…" className="input max-w-md" /><input type="hidden" name="scope" value={scope} /></form>
      <div className="space-y-6">
        <Card title={`My teams (${filterText(mine).length})`}><List list={filterText(mine)} /></Card>
        {led.length ? <Card title={`Teams I lead (${filterText(led).length})`}><List list={filterText(led)} /></Card> : null}
        {linked.length ? <Card title="Linked (synergy / projects)"><List list={filterText(linked)} /></Card> : null}
        {[...grouped.entries()].sort().map(([g, list]) => (
          <Card key={g} title={`${g} (${list.length})`}><List list={list} /></Card>
        ))}
      </div>
    </>
  );
}
