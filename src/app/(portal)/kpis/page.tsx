import Link from "next/link";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { canViewBodyWork, leadsBody } from "@/lib/access";
import { withActuals } from "@/lib/kpi";
import { bodyPath } from "@/lib/org";
import { Card, Empty, PageHeader } from "@/components/ui";
import { KpiTable } from "@/components/kpi-table";
import { ActionForm, SubmitButton } from "@/components/forms";
import { addKpiEntryAction } from "./actions";

export const metadata = { title: "KPIs" };

export default async function KpisPage() {
  const { actor, org } = await requireActor();
  const all = await db.select().from(s.kpis).where(eq(s.kpis.termId, org.termId));
  const mine = await withActuals(all.filter((k) => k.userId === actor.id));
  const myBodies = await withActuals(all.filter((k) => !k.userId && actor.memberBodyIds.has(k.bodyId)));
  const led = await withActuals(all.filter((k) => !k.userId && !actor.memberBodyIds.has(k.bodyId) && leadsBody(actor, org, k.bodyId) && canViewBodyWork(actor, org, k.bodyId)));
  const names = new Map([...org.bodies.values()].map((b) => [b.id, bodyPath(org, b.id) || b.name]));

  // National comparison by metric (MC): same metric across LCs, this term vs last term.
  let comparison: { metric: string; name: string; rows: { body: string; bodyId: string; target: number; actual: number; pct: number }[]; lastTerm?: { actual: number; target: number } }[] = [];
  if (actor.isMC) {
    const visible = await withActuals(all.filter((k) => !k.userId && k.metricKey && canViewBodyWork(actor, org, k.bodyId)));
    const byMetric = new Map<string, typeof visible>();
    for (const k of visible) byMetric.set(k.metricKey!, [...(byMetric.get(k.metricKey!) ?? []), k]);
    const [prevTerm] = await db.select().from(s.terms).where(eq(s.terms.status, "closed")).orderBy(desc(s.terms.startsOn));
    const prev = prevTerm ? await withActuals(await db.select().from(s.kpis).where(and(eq(s.kpis.termId, prevTerm.id), isNotNull(s.kpis.metricKey), inArray(s.kpis.metricKey, [...byMetric.keys()].length ? [...byMetric.keys()] : ["-"])))) : [];
    comparison = [...byMetric.entries()].map(([metric, list]) => {
      const p = prev.filter((x) => x.metricKey === metric);
      return {
        metric, name: list[0]!.name,
        rows: list.filter((k) => org.bodies.get(k.bodyId)?.type === "department").map((k) => ({ body: names.get(k.bodyId)!, bodyId: k.bodyId, target: k.target, actual: k.actual, pct: k.achievement })).sort((a, b) => b.pct - a.pct),
        lastTerm: p.length ? { actual: p.reduce((a, x) => a + x.actual, 0), target: p.reduce((a, x) => a + x.target, 0) } : undefined,
      };
    }).filter((c) => c.rows.length);
  }
  const loggable = [...mine, ...myBodies].filter((k) => k.source === "manual");

  return (
    <>
      <PageHeader title="KPIs" subtitle="Targets vs actuals. KPIs marked “auto” are calculated from trackers and completed tasks — no double entry." />
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="My individual KPIs" bodyClass="p-0" className="lg:col-span-2"><KpiTable kpis={mine} /></Card>
          <Card title="Log progress">
            {loggable.length ? (
              <ActionForm action={addKpiEntryAction} resetOnSuccess>
                <select name="kpiId" className="input">{loggable.map((k) => <option key={k.id} value={k.id}>{k.name}{k.userId ? " (mine)" : ` · ${names.get(k.bodyId)}`}</option>)}</select>
                <input name="value" type="number" step="any" placeholder="+1" className="input" />
                <input name="note" placeholder="Note" className="input" />
                <SubmitButton className="btn-secondary">Log</SubmitButton>
              </ActionForm>
            ) : <Empty>No manual KPIs to log. Auto KPIs update from trackers.</Empty>}
          </Card>
        </div>
        <Card title="My teams' KPIs" bodyClass="p-0"><KpiTable kpis={myBodies} bodyNames={names} showBody /></Card>
        {led.length ? <Card title="KPIs of teams I lead" bodyClass="p-0"><KpiTable kpis={led} bodyNames={names} showBody /></Card> : null}
        {comparison.map((c) => (
          <Card key={c.metric} title={`National comparison — ${c.name}`} actions={c.lastTerm ? <span className="text-xs text-gray-500">Last term national: {c.lastTerm.actual.toLocaleString("en-IN")} / {c.lastTerm.target.toLocaleString("en-IN")}</span> : null} bodyClass="p-0">
            <table className="table">
              <thead><tr><th>Body</th><th className="text-right">Target</th><th className="text-right">Actual</th><th className="text-right">%</th></tr></thead>
              <tbody>{c.rows.map((r) => (<tr key={r.bodyId}><td><Link className="link" href={`/bodies/${r.bodyId}`}>{r.body}</Link></td><td className="text-right">{r.target.toLocaleString("en-IN")}</td><td className="text-right font-semibold">{r.actual.toLocaleString("en-IN")}</td><td className={`text-right font-semibold ${r.pct >= 90 ? "text-green-600" : r.pct >= 60 ? "text-amber-600" : "text-red-600"}`}>{r.pct}%</td></tr>))}</tbody>
            </table>
          </Card>
        ))}
      </div>
    </>
  );
}
