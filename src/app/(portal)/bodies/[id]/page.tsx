import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { canContributeToBody, canManageBody, canViewBodyWork, canViewDocument, subtreeOf } from "@/lib/access";
import { withActuals } from "@/lib/kpi";
import { bodyHealth } from "@/lib/insights";
import { bodyPath, usersByIds } from "@/lib/org";
import { Avatar, Badge, Card, Empty, Health, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { KpiTable } from "@/components/kpi-table";
import { ActionForm, SubmitButton } from "@/components/forms";
import { fmtDate, titleCase } from "@/lib/util";
import { addKpiEntryAction, createKpiAction } from "../../kpis/actions";
import { createTrackerAction } from "../../trackers/actions";
import { TRACKER_TEMPLATES } from "@/lib/tracker-templates";

export const metadata = { title: "Body" };

export default async function BodyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, org } = await requireActor();
  const body = org.bodies.get(id);
  if (!body) notFound();
  const fullAccess = canViewBodyWork(actor, org, id);
  const confidential = body.visibility === "confidential" && !fullAccess;
  const archived = body.termId !== org.termId;
  if (archived && !fullAccess) notFound();
  const manager = canManageBody(actor, org, id);
  const contributor = canContributeToBody(actor, org, id);
  const [term] = await db.select().from(s.terms).where(eq(s.terms.id, body.termId));

  const positions = [...org.positions.values()].filter((p) => p.bodyId === id).sort((a, b) => a.sortOrder - b.sortOrder);
  // For archived bodies show who held positions back then (inactive assignments).
  const assignmentRows = await db.select().from(s.assignments).where(inArray(s.assignments.positionId, positions.length ? positions.map((p) => p.id) : ["00000000-0000-0000-0000-000000000000"]));
  const holderIds = (pid: string) => assignmentRows.filter((a) => a.positionId === pid && (archived || a.active)).map((a) => a.userId);
  const people = await usersByIds(assignmentRows.map((a) => a.userId));
  const children = (org.children.get(id) ?? []).map((c) => org.bodies.get(c)!).filter(Boolean);
  const linked = (org.links.get(id) ?? []).map((l) => org.bodies.get(l)!).filter(Boolean);
  const lineage = body.lineageKey ? [...org.bodies.values()].filter((b) => b.lineageKey === body.lineageKey && b.id !== id) : [];
  const termCodes = new Map((await db.select().from(s.terms)).map((t) => [t.id, t.code]));

  let kpis: Awaited<ReturnType<typeof withActuals>> = [];
  let trackers: (typeof s.trackers.$inferSelect)[] = [];
  let docs: (typeof s.documents.$inferSelect)[] = [];
  let openTasks: (typeof s.tasks.$inferSelect)[] = [];
  let cases: (typeof s.cases.$inferSelect)[] = [];
  let health = null as Awaited<ReturnType<typeof bodyHealth>> | null;
  if (fullAccess) {
    [kpis, trackers, docs, cases] = await Promise.all([
      db.select().from(s.kpis).where(eq(s.kpis.bodyId, id)).then(withActuals),
      db.select().from(s.trackers).where(eq(s.trackers.bodyId, id)),
      db.select().from(s.documents).where(eq(s.documents.bodyId, id)).orderBy(desc(s.documents.createdAt)),
      db.select().from(s.cases).where(eq(s.cases.bodyId, id)),
    ]);
    docs = docs.filter((d) => canViewDocument(actor, org, d));
    if (!archived) {
      health = await bodyHealth(org, id);
      if (manager || actor.isMC) {
        openTasks = await db.select().from(s.tasks).where(and(inArray(s.tasks.bodyId, [...subtreeOf(org, id)]), notInArray(s.tasks.status, ["completed", "rejected"]))).limit(50);
      }
    }
  }
  const taskPeople = await usersByIds(openTasks.map((t) => t.assigneeId));
  const memberCount = new Set(positions.flatMap((p) => holderIds(p.id))).size;

  return (
    <>
      <PageHeader
        title={body.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">{titleCase(body.type)}</Badge>
            {body.departmentKey ? <Badge tone="purple">{body.departmentKey}</Badge> : null}
            <Badge tone={archived ? "gray" : "green"}>Term {term?.code}{archived ? " · archived" : ""}</Badge>
            {body.visibility === "confidential" ? <Badge tone="red">Confidential</Badge> : null}
            <span className="text-gray-500">{bodyPath(org, id)}</span>
          </span>
        }
        actions={archived ? <Link href={`/archive/${body.termId}`} className="btn-secondary">← {term?.code} archive</Link> : manager ? <Link href={`/tasks/new`} className="btn-secondary">➕ Task</Link> : null}
      />
      {body.description ? <p className="-mt-3 mb-4 text-sm text-gray-600">{body.description}</p> : null}
      {archived ? <Notice tone="yellow">🗄️ This is the {term?.code} record. Everything here is read-only and kept for the next generations.</Notice> : null}
      {confidential ? <Notice tone="red">This body is confidential. You can see its members, but not its work.</Notice> : !fullAccess ? <Notice>You can see the structure of this body. Its trackers, KPIs and documents are visible to its members, its leadership chain and the MC.</Notice> : null}
      {(body.startsOn || body.endsOn) ? <p className="mb-4 text-sm text-gray-500">Runs {fmtDate(body.startsOn)} → {fmtDate(body.endsOn)}</p> : null}

      {health ? (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
          <div className="card p-4"><div className="label">Health</div><div className="text-2xl"><Health score={health.score} /></div></div>
          <div className="card p-4"><div className="label">KPI achievement</div><div className="text-xl font-bold">{health.kpi ?? "—"}{health.kpi !== null ? "%" : ""}</div></div>
          <div className="card p-4"><div className="label">Reporting (7d)</div><div className="text-xl font-bold">{health.reporting ?? "—"}{health.reporting !== null ? "%" : ""}</div></div>
          <div className="card p-4"><div className="label">Tasks on track</div><div className="text-xl font-bold">{health.tasks ?? "—"}{health.tasks !== null ? "%" : ""}</div></div>
          <div className="card p-4"><div className="label">People</div><div className="text-xl font-bold">{health.members}</div></div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {fullAccess ? (
            <>
              <Card title="KPIs" bodyClass="p-0">
                <KpiTable kpis={kpis} />
                {!archived && (manager || contributor) ? (
                  <div className="grid gap-4 border-t border-gray-100 p-4 md:grid-cols-2">
                    {kpis.some((k) => k.source === "manual") && contributor ? (
                      <ActionForm action={addKpiEntryAction} resetOnSuccess className="space-y-2">
                        <div className="text-sm font-semibold">Log progress</div>
                        <select name="kpiId" className="input">{kpis.filter((k) => k.source === "manual").map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select>
                        <div className="flex gap-2"><input name="value" type="number" step="any" placeholder="+5" className="input" /><input name="date" type="date" className="input" /></div>
                        <input name="note" placeholder="Note (optional)" className="input" />
                        <SubmitButton className="btn-secondary btn-sm">Log</SubmitButton>
                      </ActionForm>
                    ) : <div className="text-xs text-gray-500">KPIs marked “auto” update themselves from the tracker and from completed KPI-linked tasks.</div>}
                    {manager ? (
                      <ActionForm action={createKpiAction} resetOnSuccess className="space-y-2">
                        <div className="text-sm font-semibold">New KPI</div>
                        <input type="hidden" name="bodyId" value={id} />
                        <input name="name" placeholder="e.g. Approvals" className="input" />
                        <div className="flex gap-2"><input name="target" type="number" step="any" placeholder="Target" className="input" /><select name="unit" className="input"><option value="count">count</option><option value="BDT">BDT</option><option value="%">%</option></select></div>
                        <select name="trackerRollup" className="input" defaultValue="">
                          <option value="">Manual entries</option>
                          {trackers.flatMap((t) => t.rollups.map((r, i) => <option key={`${t.id}:${i}`} value={`${t.id}:${i}`}>Auto: {t.name} → {r.label}</option>))}
                        </select>
                        <SubmitButton className="btn-secondary btn-sm">Add KPI</SubmitButton>
                      </ActionForm>
                    ) : null}
                  </div>
                ) : null}
              </Card>

              <Card title="Trackers">
                {trackers.length ? (
                  <ul className="space-y-2 text-sm">
                    {trackers.map((t) => (<li key={t.id}>📋 <Link className="link" href={`/trackers/${t.id}`}>{t.name}</Link>{t.frozen ? <span className="ml-2 text-xs text-gray-400">frozen</span> : null}</li>))}
                  </ul>
                ) : <Empty>No tracker yet.</Empty>}
                {manager && !archived ? (
                  <ActionForm action={createTrackerAction} className="mt-4 flex flex-wrap gap-2">
                    <input type="hidden" name="bodyId" value={id} />
                    <input name="name" placeholder="New tracker name" className="input max-w-xs" />
                    <select name="template" className="input max-w-xs" defaultValue=""><option value="">Blank</option>{Object.values(TRACKER_TEMPLATES).map((t) => <option key={t.key} value={t.key}>Template: {t.name}</option>)}</select>
                    <SubmitButton className="btn-secondary">Create</SubmitButton>
                  </ActionForm>
                ) : null}
              </Card>

              <Card title={`Documents (${docs.length})`} actions={!archived && contributor ? <Link className="link text-sm" href={`/documents?upload=1&body=${id}`}>Upload</Link> : null}>
                {docs.length ? (
                  <ul className="divide-y divide-gray-100 text-sm">
                    {docs.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                        <span>{d.fileId ? <a className="link" href={`/api/files/doc/${d.id}`}>{d.title}</a> : d.externalUrl ? <a className="link" href={d.externalUrl} target="_blank" rel="noreferrer noopener">{d.title}</a> : d.title}</span>
                        <span className="flex gap-1"><Badge>{titleCase(d.category)}</Badge><Badge tone={d.classification.startsWith("confidential") ? "red" : d.classification === "internal" ? "green" : "yellow"}>{titleCase(d.classification)}</Badge></span>
                      </li>
                    ))}
                  </ul>
                ) : <Empty>No documents yet.</Empty>}
              </Card>

              {openTasks.length ? (
                <Card title={`Open tasks in this body (${openTasks.length})`} bodyClass="p-0">
                  <table className="table"><tbody>
                    {openTasks.map((t) => (<tr key={t.id}><td><Link className="hover:underline" href={`/tasks/${t.id}`}>{t.title}</Link></td><td>{taskPeople.get(t.assigneeId)?.name}</td><td><StatusBadge status={t.status} /></td><td className="text-xs">{t.dueAt ? fmtDate(t.dueAt) : ""}</td></tr>))}
                  </tbody></table>
                </Card>
              ) : null}

              {cases.length ? (
                <Card title="Cases & lessons from this body">
                  <ul className="space-y-1 text-sm">{cases.map((c) => <li key={c.id}>{c.kind === "good_case" ? "🌟" : "📘"} <Link className="link" href={`/knowledge/${c.id}`}>{c.title}</Link></li>)}</ul>
                </Card>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card title={`People (${memberCount})`}>
            {positions.length ? (
              <ul className="space-y-3">
                {positions.map((p) => {
                  const holders = holderIds(p.id);
                  return (
                    <li key={p.id}>
                      <div className="text-xs font-semibold uppercase text-gray-500">{p.title}{p.isLeader ? " · lead" : ""}</div>
                      {holders.length ? holders.map((u) => (
                        <Link key={u} href={`/people/${u}`} className="mt-1 flex items-center gap-2 text-sm hover:underline"><Avatar name={people.get(u)?.name ?? "?"} size={24} />{people.get(u)?.name}</Link>
                      )) : <div className="text-sm text-gray-400">Vacant</div>}
                    </li>
                  );
                })}
              </ul>
            ) : <Empty>No positions defined.</Empty>}
          </Card>
          {children.length ? (
            <Card title="Inside this body">
              <ul className="space-y-1.5 text-sm">
                {children.map((c) => (<li key={c.id}><Link className="link" href={`/bodies/${c.id}`}>{c.name}</Link> <span className="text-xs text-gray-400">{c.type}</span></li>))}
              </ul>
            </Card>
          ) : null}
          {linked.length ? (
            <Card title="Synergy with">
              <ul className="space-y-1.5 text-sm">{linked.map((c) => (<li key={c.id}><Link className="link" href={`/bodies/${c.id}`}>{c.name}</Link></li>))}</ul>
            </Card>
          ) : null}
          {lineage.length ? (
            <Card title="Same body in other terms">
              <ul className="space-y-1.5 text-sm">
                {lineage.map((b) => (<li key={b.id}><Link className="link" href={`/bodies/${b.id}`}>{termCodes.get(b.termId)} — {b.name}</Link></li>))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
