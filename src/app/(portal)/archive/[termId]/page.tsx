import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { canViewBodyWork, canViewDocument } from "@/lib/access";
import { withActuals } from "@/lib/kpi";
import { usersByIds } from "@/lib/org";
import { Badge, Card, Empty, Notice, PageHeader, Progress } from "@/components/ui";
import { fmtDate, titleCase } from "@/lib/util";

export const metadata = { title: "Term" };

const CATEGORY_ICON: Record<string, string> = { strategy: "🧭", plan: "🗺", report: "📊", numbers: "🔢", handover: "🤝", playbook: "📘", sop: "📘", policy: "📜", constitution: "📜", minutes: "📝", decision: "⚖️", mou: "🤝" };

export default async function TermArchive({ params, searchParams }: { params: Promise<{ termId: string }>; searchParams: Promise<{ q?: string; cat?: string }> }) {
  const { termId } = await params;
  const { q = "", cat = "" } = await searchParams;
  const { actor, org } = await requireActor();
  const [term] = await db.select().from(s.terms).where(eq(s.terms.id, termId));
  if (!term) notFound();
  const bodies = [...org.bodies.values()].filter((b) => b.termId === termId);
  const byType = (t: string) => bodies.filter((b) => b.type === t);
  const mc = byType("mc")[0];
  const mcDepts = mc ? bodies.filter((b) => b.parentId === mc.id && b.type === "department").sort((a, b) => a.name.localeCompare(b.name)) : [];

  const [allDocs, allKpis, decisions, cases] = await Promise.all([
    db.select().from(s.documents).where(eq(s.documents.termId, termId)).orderBy(desc(s.documents.createdAt)),
    db.select().from(s.kpis).where(eq(s.kpis.termId, termId)),
    db.select().from(s.decisions).where(eq(s.decisions.termId, termId)).orderBy(desc(s.decisions.decidedOn)),
    db.select().from(s.cases).where(eq(s.cases.termId, termId)),
  ]);
  const docs = allDocs.filter((d) => canViewDocument(actor, org, d)).filter((d) => (!q || `${d.title} ${d.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase())) && (!cat || d.category === cat));
  const kpis = await withActuals(allKpis.filter((k) => !k.userId && canViewBodyWork(actor, org, k.bodyId)));
  const leaders = await db.select().from(s.assignments).where(eq(s.assignments.termId, termId));
  const people = await usersByIds(leaders.map((a) => a.userId));
  const holdersOf = (bodyId: string) =>
    [...org.positions.values()].filter((p) => p.bodyId === bodyId && p.isLeader).flatMap((p) => leaders.filter((a) => a.positionId === p.id).map((a) => `${p.title}: ${people.get(a.userId)?.name}`));
  const fmt = (n: number, unit: string) => (unit === "BDT" ? `৳ ${n.toLocaleString("en-IN")}` : unit === "%" ? `${n}%` : n.toLocaleString("en-IN"));
  const visibleDecisions = decisions.filter((d) => canViewBodyWork(actor, org, d.bodyId) || actor.isMC);
  const closed = term.status === "closed";

  return (
    <>
      <PageHeader
        title={`Term ${term.code}`}
        subtitle={`${fmtDate(term.startsOn)} – ${fmtDate(term.endsOn)} · ${closed ? `archived ${fmtDate(term.closedAt)}` : term.status === "active" ? "current term (live)" : "planning"}`}
        actions={<Link href="/archive" className="btn-secondary">All terms</Link>}
      />
      {closed ? <Notice tone="yellow">🗄️ Read-only record of {term.code}. You see what your position allows — MC members see every department; others see their own lineage.</Notice> : null}

      {mc ? (
        <Card title={`${mc.name} — ${mcDepts.length} departments`} className="mb-6" actions={<Link className="link text-sm" href={`/bodies/${mc.id}`}>MC space</Link>}>
          {holdersOf(mc.id).length ? <div className="mb-3 text-sm text-gray-600">{holdersOf(mc.id).join(" · ")}</div> : null}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {mcDepts.map((d) => {
              const dk = kpis.filter((k) => k.bodyId === d.id);
              const dd = docs.filter((x) => x.bodyId === d.id);
              const can = canViewBodyWork(actor, org, d.id);
              return (
                <div key={d.id} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center justify-between"><Link className="font-semibold hover:underline" href={`/bodies/${d.id}`}>{d.shortName ?? d.name}</Link>{d.departmentKey ? <Badge tone="purple">{d.departmentKey}</Badge> : null}</div>
                  <div className="text-xs text-gray-500">{holdersOf(d.id).join(", ") || "—"}</div>
                  {can ? (
                    <>
                      <ul className="mt-2 space-y-1.5">
                        {dk.map((k) => (
                          <li key={k.id} className="text-xs">
                            <div className="flex justify-between"><span>{k.name}</span><span className="font-semibold">{fmt(k.actual, k.unit)} / {fmt(k.target, k.unit)}</span></div>
                            <Progress value={k.achievement} />
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 text-xs text-gray-500">{dd.length} document{dd.length === 1 ? "" : "s"}</div>
                    </>
                  ) : <div className="mt-2 text-xs text-gray-400">Work visible to MC and this department&apos;s lineage.</div>}
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={`Documents (${docs.length})`} className="lg:col-span-2" bodyClass="p-0">
          <form className="flex flex-wrap gap-2 border-b border-gray-100 p-3">
            <input name="q" defaultValue={q} placeholder="Search this term's documents…" className="input max-w-xs" />
            <select name="cat" defaultValue={cat} className="input max-w-[180px]"><option value="">All categories</option>{[...new Set(allDocs.map((d) => d.category))].map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</select>
            <button className="btn-secondary">Filter</button>
          </form>
          {docs.length ? (
            <table className="table">
              <thead><tr><th>Document</th><th>Body</th><th>Class.</th></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td>{CATEGORY_ICON[d.category] ?? "📄"} {d.fileId ? <a className="link" href={`/api/files/doc/${d.id}`}>{d.title}</a> : d.externalUrl ? <a className="link" href={d.externalUrl} target="_blank" rel="noreferrer noopener">{d.title}</a> : d.title}<div className="text-xs text-gray-400">{titleCase(d.category)}</div></td>
                    <td className="text-xs"><Link className="link" href={`/bodies/${d.bodyId}`}>{org.bodies.get(d.bodyId)?.name}</Link></td>
                    <td><Badge tone={d.classification.startsWith("confidential") ? "red" : d.classification === "internal" ? "green" : "yellow"}>{titleCase(d.classification)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="p-4"><Empty>No documents you can access.</Empty></div>}
        </Card>
        <div className="space-y-6">
          <Card title={`LCs (${byType("lc").length})`}>
            <ul className="space-y-1.5 text-sm">{byType("lc").map((b) => <li key={b.id}><Link className="link" href={`/bodies/${b.id}`}>{b.name}</Link><div className="text-xs text-gray-500">{holdersOf(b.id).join(", ")}</div></li>)}</ul>
          </Card>
          <Card title="Governance, support, OCs & projects">
            <ul className="space-y-1.5 text-sm">
              {[...byType("governance"), ...byType("support"), ...byType("oc"), ...byType("project"), ...byType("synergy")].map((b) => (
                <li key={b.id}><Link className="link" href={`/bodies/${b.id}`}>{b.name}</Link> <span className="text-xs text-gray-400">{b.type}</span></li>
              ))}
            </ul>
          </Card>
          <Card title={`Decision log (${visibleDecisions.length})`}>
            {visibleDecisions.length ? <ul className="space-y-2 text-sm">{visibleDecisions.map((d) => <li key={d.id}><span className="font-mono text-xs text-gray-500">{d.code}</span><div>{d.title}</div></li>)}</ul> : <Empty>No decisions logged.</Empty>}
          </Card>
          <Card title={`Cases & lessons (${cases.length})`}>
            {cases.length ? <ul className="space-y-1.5 text-sm">{cases.map((c) => <li key={c.id}>{c.kind === "good_case" ? "🌟" : "📘"} <Link className="link" href={`/knowledge/${c.id}`}>{c.title}</Link></li>)}</ul> : <Empty>None recorded.</Empty>}
          </Card>
        </div>
      </div>
    </>
  );
}
