import { redirect } from "next/navigation";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { withActuals } from "@/lib/kpi";
import { Card, Empty, PageHeader, Stat } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/util";

export const metadata = { title: "AIESEC in Bangladesh" };

/**
 * Restricted external experience for the Board of Advisors and partners.
 * Shows aggregates and content explicitly classified "external" — never individual performance,
 * private messages, internal newsfeed, HR records or confidential documents.
 */
export default async function ExternalPage() {
  const { actor, org } = await requireActor({ stage: "onboarding" });
  if (!actor.isExternal) redirect("/dashboard");
  const isBoa = actor.user.userType === "boa";
  const [docs, ann, events, posts] = await Promise.all([
    db.select().from(s.documents).where(eq(s.documents.classification, "external")).orderBy(desc(s.documents.createdAt)),
    db.select().from(s.announcements).where(eq(s.announcements.audience, "external")).orderBy(desc(s.announcements.createdAt)).limit(10),
    db.select().from(s.events).where(and(eq(s.events.audience, "external"), gte(s.events.startsAt, new Date()))).limit(10),
    db.select().from(s.posts).where(eq(s.posts.audience, "external")).orderBy(desc(s.posts.createdAt)).limit(10),
  ]);
  let overview: { members: number; lcs: number; metrics: { name: string; actual: number; target: number; unit: string }[] } | null = null;
  if (isBoa) {
    const lcs = [...org.bodies.values()].filter((b) => b.termId === org.termId && b.type === "lc");
    const kpis = await withActuals(await db.select().from(s.kpis).where(and(eq(s.kpis.termId, org.termId), isNull(s.kpis.userId))));
    const byMetric = new Map<string, { name: string; actual: number; target: number; unit: string }>();
    for (const k of kpis.filter((k) => k.metricKey && org.bodies.get(k.bodyId)?.type === "department")) {
      const m = byMetric.get(k.metricKey!) ?? { name: `${k.departmentKey} · ${k.name}`, actual: 0, target: 0, unit: k.unit };
      m.actual += k.actual;
      m.target += k.target;
      byMetric.set(k.metricKey!, m);
    }
    overview = { members: org.userPositions.size, lcs: lcs.length, metrics: [...byMetric.values()] };
  }
  return (
    <>
      <PageHeader title={isBoa ? "National overview — Board of Advisors" : `Welcome, ${actor.user.name}`} subtitle="A restricted view: aggregate numbers and material the MC has shared externally." />
      {overview ? (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Active members" value={overview.members} /><Stat label="Local committees" value={overview.lcs} /></div>
          <Card title="Strategic KPIs (national, aggregated)" className="mb-6" bodyClass="p-0">
            <table className="table"><tbody>{overview.metrics.map((m) => <tr key={m.name}><td>{m.name}</td><td className="text-right font-semibold">{m.unit === "BDT" ? `৳ ${m.actual.toLocaleString("en-IN")}` : m.actual} / {m.unit === "BDT" ? `৳ ${m.target.toLocaleString("en-IN")}` : m.target}</td></tr>)}</tbody></table>
          </Card>
        </>
      ) : null}
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Updates">{ann.length || posts.length ? <ul className="space-y-3 text-sm">{[...ann.map((a) => ({ k: a.id, t: a.title, b: a.body, d: a.createdAt })), ...posts.map((p) => ({ k: p.id, t: "", b: p.body, d: p.createdAt }))].map((x) => <li key={x.k}>{x.t ? <strong>{x.t}</strong> : null}<p className="text-gray-700">{x.b}</p><div className="text-xs text-gray-400">{fmtDate(x.d)}</div></li>)}</ul> : <Empty>No shared updates yet.</Empty>}</Card>
        <Card title="Documents shared with you">{docs.length ? <ul className="space-y-1 text-sm">{docs.map((d) => <li key={d.id}>{d.fileId ? <a className="link" href={`/api/files/doc/${d.id}`}>{d.title}</a> : d.title}</li>)}</ul> : <Empty>No documents shared yet.</Empty>}</Card>
        <Card title="Upcoming events">{events.length ? <ul className="space-y-1 text-sm">{events.map((e) => <li key={e.id}>{e.title} <span className="text-xs text-gray-500">{fmtDateTime(e.startsAt)}</span></li>)}</ul> : <Empty>No upcoming events.</Empty>}</Card>
      </div>
      <form action="/logout" method="post" className="mt-6"><button className="btn-secondary">Sign out</button></form>
    </>
  );
}
