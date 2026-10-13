import Link from "next/link";
import { and, eq, inArray, isNull, sql as dsql } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor, denied } from "@/lib/session";
import { rootOf, subtreeOf } from "@/lib/access";
import { applyRollup, averageAchievement, withActuals } from "@/lib/kpi";
import { attentionFor, bodyHealth, reportingFor, taskHealth } from "@/lib/insights";
import { contributionScores } from "@/lib/leaderboard";
import { usersByIds } from "@/lib/org";
import { Card, Empty, Health, PageHeader, Stat } from "@/components/ui";

export const metadata = { title: "Command Center" };

const DEPTS = ["OGX", "ICX", "BD", "MKT", "FNL", "MX"];

export default async function CommandCenter() {
  const { actor, org } = await requireActor();
  if (!actor.isMC) denied();
  const root = rootOf(org, org.termId);
  const termBodies = [...org.bodies.values()].filter((b) => b.termId === org.termId);
  const lcs = termBodies.filter((b) => b.type === "lc").sort((a, b) => a.name.localeCompare(b.name));
  const mc = termBodies.find((b) => b.type === "mc");

  const lcHealth = await Promise.all(lcs.map((lc) => bodyHealth(org, lc.id)));
  const mcHealth = mc ? await bodyHealth(org, mc.id) : null;
  const scores = [...lcHealth, ...(mcHealth ? [mcHealth] : [])].map((h) => h.score).filter((x): x is number => x !== null);
  const entityHealth = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  // Department × LC heatmap
  const allKpis = await withActuals(await db.select().from(s.kpis).where(and(eq(s.kpis.termId, org.termId), isNull(s.kpis.userId))));
  const cell = (lcId: string, dept: string) => {
    const bodies = [...subtreeOf(org, lcId)].filter((b) => org.bodies.get(b)?.departmentKey === dept && org.bodies.get(b)?.type === "department");
    return averageAchievement(allKpis.filter((k) => bodies.includes(k.bodyId)));
  };
  // National portfolio: sum LC actuals per metric vs sum LC targets
  const portfolio = DEPTS.map((d) => {
    const ks = allKpis.filter((k) => k.departmentKey === d && org.bodies.get(k.bodyId)?.type === "department" && lcs.some((lc) => subtreeOf(org, lc.id).has(k.bodyId)));
    const byMetric = new Map<string, { name: string; actual: number; target: number; unit: string }>();
    for (const k of ks) {
      const m = byMetric.get(k.metricKey ?? k.name) ?? { name: k.name, actual: 0, target: 0, unit: k.unit };
      m.actual += k.actual;
      m.target += k.target;
      byMetric.set(k.metricKey ?? k.name, m);
    }
    return { dept: d, metrics: [...byMetric.values()], avg: averageAchievement(ks) };
  });

  // Finance from MC FNL tracker
  const fnlBody = termBodies.find((b) => b.type === "department" && b.departmentKey === "FNL" && b.parentId === mc?.id);
  const [fnlTracker] = fnlBody ? await db.select().from(s.trackers).where(eq(s.trackers.bodyId, fnlBody.id)) : [];
  const fnlRows = fnlTracker ? await db.select({ data: s.trackerRows.data }).from(s.trackerRows).where(eq(s.trackerRows.trackerId, fnlTracker.id)) : [];
  const money = (label: string) => {
    const r = fnlTracker?.rollups.find((x) => x.label.startsWith(label));
    return r ? applyRollup(fnlRows, r) : 0;
  };

  // Membership & pipeline
  const activeUsers = new Set([...org.userPositions.keys()]);
  const [{ n: candidatesOpen }] = await db.select({ n: dsql<number>`count(*)::int` }).from(s.candidates).where(and(eq(s.candidates.termId, org.termId), inArray(s.candidates.status, ["applied", "shortlisted", "assessed", "interviewed", "selected", "offer_sent", "offer_viewed", "offer_accepted", "nda_signed", "account_created", "account_activated", "onboarding_in_progress"])));
  const rep = await reportingFor([...activeUsers], org.termId);
  const reportingRate = rep.length ? Math.round((rep.reduce((a, r) => a + (7 - r.missedDays), 0) / (rep.length * 7)) * 100) : null;
  const th = await taskHealth({ assigneeIds: [...activeUsers] }, org.termId);

  // Projects
  const projects = termBodies.filter((b) => b.type === "project" || b.type === "oc");
  const projTrackers = projects.length ? await db.select().from(s.trackers).where(inArray(s.trackers.bodyId, projects.map((p) => p.id))) : [];
  const projRows = projTrackers.length ? await db.select().from(s.trackerRows).where(inArray(s.trackerRows.trackerId, projTrackers.map((t) => t.id))) : [];
  const projStatus = projects.map((p) => {
    const t = projTrackers.find((x) => x.bodyId === p.id);
    const rows = projRows.filter((r) => r.trackerId === t?.id);
    const bad = rows.filter((r) => /delayed|at risk|blocked/i.test(String(r.data.status ?? ""))).length;
    const done = rows.filter((r) => /done/i.test(String(r.data.status ?? ""))).length;
    return { p, total: rows.length, done, bad };
  });

  const attention = root ? await attentionFor(org, [root.id], org.termId) : [];
  const since = new Date(Date.now() - 30 * 86_400_000);
  const top = (await contributionScores([...activeUsers], since)).slice(0, 5);
  const topUsers = await usersByIds(top.map((t) => t.userId));
  const lcRanked = lcs.map((lc, i) => ({ lc, h: lcHealth[i]! })).sort((a, b) => (b.h.score ?? 0) - (a.h.score ?? 0));
  const colour = (v: number | null) => (v === null ? "bg-gray-50 text-gray-400" : v >= 85 ? "bg-green-100 text-green-800" : v >= 60 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800");
  const bdt = (n: number) => `৳ ${n.toLocaleString("en-IN")}`;

  return (
    <>
      <PageHeader title="🇧🇩 National Command Center" subtitle="Entity health is a decision-support signal built from KPI achievement, reporting consistency and task health — not a verdict." />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Entity health" value={<Health score={entityHealth} />} />
        <Stat label="Active members" value={activeUsers.size} hint={`${lcs.length} LCs`} href="/directory" />
        <Stat label="Reporting (7d)" value={reportingRate === null ? "—" : `${reportingRate}%`} href="/reporting" />
        <Stat label="Tasks on track" value={th.total ? `${Math.round(((th.total - th.overdue) / th.total) * 100)}%` : "—"} hint={`${th.overdue} overdue · ${th.blocked} blocked`} />
        <Stat label="Recruitment pipeline" value={candidatesOpen} href="/recruitment" />
        <Stat label="Income (MC ledger)" value={bdt(money("Income"))} hint={`Expenses ${bdt(money("Expenses"))}`} />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card title="🔴 What needs my attention" className="lg:col-span-2">
          {attention.length ? (
            <ul className="divide-y divide-gray-100">
              {attention.slice(0, 12).map((a, i) => (
                <li key={i} className="py-2 text-sm">{a.level === "red" ? "🔴" : "🟠"} {a.link ? <Link className="font-medium hover:underline" href={a.link}>{a.title}</Link> : a.title}<div className="text-xs text-gray-500">{a.detail}</div></li>
              ))}
            </ul>
          ) : <Empty>All clear.</Empty>}
        </Card>
        <Card title="🏆 Top contributors (30 days)" actions={<Link className="link text-sm" href="/leaderboard">Leaderboard</Link>}>
          <ol className="space-y-2 text-sm">
            {top.map((t, i) => (<li key={t.userId} className="flex justify-between"><span>{i + 1}. <Link className="hover:underline" href={`/people/${t.userId}`}>{topUsers.get(t.userId)?.name}</Link></span><span className="font-semibold">{t.score}</span></li>))}
          </ol>
        </Card>
      </div>

      <Card title="LC health" className="mb-6" bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>LC</th><th>Health</th><th>KPI</th><th>Reporting</th><th>Tasks</th><th>People</th></tr></thead>
            <tbody>
              {lcRanked.map(({ lc, h }) => (
                <tr key={lc.id}><td><Link className="link font-medium" href={`/bodies/${lc.id}`}>{lc.name}</Link></td><td><Health score={h.score} /></td><td>{h.kpi ?? "—"}%</td><td>{h.reporting ?? "—"}%</td><td>{h.tasks ?? "—"}%</td><td>{h.members}</td></tr>
              ))}
              {mc && mcHealth ? <tr className="bg-gray-50"><td><Link className="link font-medium" href={`/bodies/${mc.id}`}>{mc.name}</Link></td><td><Health score={mcHealth.score} /></td><td>{mcHealth.kpi ?? "—"}%</td><td>{mcHealth.reporting ?? "—"}%</td><td>{mcHealth.tasks ?? "—"}%</td><td>{mcHealth.members}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Performance heatmap — KPI achievement by department × LC" className="mb-6" bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="table text-center">
            <thead><tr><th className="text-left">Department</th>{lcs.map((lc) => <th key={lc.id}>{lc.shortName ?? lc.name}</th>)}</tr></thead>
            <tbody>
              {DEPTS.map((d) => (
                <tr key={d}><td className="text-left font-semibold">{d}</td>{lcs.map((lc) => { const v = cell(lc.id, d); return <td key={lc.id}><span className={`inline-block min-w-14 rounded px-2 py-1 text-xs font-semibold ${colour(v)}`}>{v === null ? "—" : `${v}%`}</span></td>; })}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mb-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {portfolio.map((p) => (
          <Card key={p.dept} title={`${p.dept} — national (sum of LCs)`} actions={<span className="text-sm font-semibold">{p.avg ?? "—"}{p.avg !== null ? "%" : ""}</span>}>
            {p.metrics.length ? (
              <ul className="space-y-1.5 text-sm">
                {p.metrics.map((m) => (<li key={m.name} className="flex justify-between"><span>{m.name}</span><span className="font-semibold">{m.unit === "BDT" ? bdt(m.actual) : m.actual} / {m.unit === "BDT" ? bdt(m.target) : m.target}</span></li>))}
              </ul>
            ) : <Empty>No KPIs defined in LCs.</Empty>}
          </Card>
        ))}
      </div>

      <Card title="Strategic projects & OCs" bodyClass="p-0">
        <table className="table">
          <thead><tr><th>Project / OC</th><th>Milestones done</th><th>At risk / delayed</th></tr></thead>
          <tbody>
            {projStatus.map(({ p, total, done, bad }) => (
              <tr key={p.id}><td><Link className="link" href={`/bodies/${p.id}`}>{p.name}</Link></td><td>{done} / {total}</td><td className={bad ? "font-semibold text-red-600" : ""}>{bad}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
