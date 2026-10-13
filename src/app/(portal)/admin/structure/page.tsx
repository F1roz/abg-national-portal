import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { db, s } from "@/db";
import { BODY_TYPES, ROLE_KEYS } from "@/db/schema";
import { requireFullAdmin } from "../guard";
import { bodyPath, usersByIds } from "@/lib/org";
import { internalPeople } from "@/lib/people";
import { Badge, Card, Field } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { assignAction, closeBodyAction, createBodyAction, createPositionAction, endAssignmentAction } from "../actions";

export default async function StructureAdmin({ searchParams }: { searchParams: Promise<{ body?: string }> }) {
  const { org } = await requireFullAdmin();
  const { body: selected } = await searchParams;
  const bodies = [...org.bodies.values()].filter((b) => b.termId === org.termId).sort((a, b) => bodyPath(org, a.id).localeCompare(bodyPath(org, b.id)));
  const positions = [...org.positions.values()].filter((p) => org.bodies.get(p.bodyId)?.termId === org.termId);
  const sel = selected ? org.bodies.get(selected) : undefined;
  const selPositions = sel ? positions.filter((p) => p.bodyId === sel.id).sort((a, b) => a.sortOrder - b.sortOrder) : [];
  const assignments = selPositions.length ? await db.select().from(s.assignments).where(and(inArray(s.assignments.positionId, selPositions.map((p) => p.id)), eq(s.assignments.active, true))) : [];
  const names = await usersByIds(assignments.map((a) => a.userId));
  const people = await internalPeople(org);
  const label = (id: string) => bodyPath(org, id) || org.bodies.get(id)?.name;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title={`Bodies this term (${bodies.length})`} bodyClass="p-0 max-h-[70vh] overflow-y-auto">
        <ul className="divide-y divide-gray-100 text-sm">
          {bodies.map((b) => (
            <li key={b.id}><Link href={`/admin/structure?body=${b.id}`} className={`flex items-center justify-between gap-2 px-3 py-2 hover:bg-gray-50 ${b.id === selected ? "bg-brand-soft" : ""}`}><span className="truncate">{label(b.id) || b.name}</span><Badge>{b.type}</Badge></Link></li>
          ))}
        </ul>
      </Card>
      <div className="space-y-6 lg:col-span-2">
        {sel ? (
          <Card title={`${sel.name} — positions & people`} actions={<span className="flex gap-2"><Link className="link text-sm" href={`/bodies/${sel.id}`}>Open space</Link>{sel.status === "active" ? <form action={closeBodyAction}><input type="hidden" name="id" value={sel.id} /><SubmitButton className="btn-ghost btn-sm text-red-600" confirm="Close this body? Its trackers freeze (e.g. an OC after the event).">Close body</SubmitButton></form> : <Badge>closed</Badge>}</span>}>
            <ul className="space-y-3 text-sm">
              {selPositions.map((p) => (
                <li key={p.id} className="rounded-lg border border-gray-100 p-2">
                  <div className="flex flex-wrap items-center gap-2"><strong>{p.title}</strong><Badge tone="purple">{p.roleKey}</Badge>{p.isLeader ? <Badge tone="blue">leader</Badge> : null}{p.multiHolder ? <Badge>multi</Badge> : null}{p.reportsToId ? <span className="text-xs text-gray-500">reports to {org.positions.get(p.reportsToId)?.title} ({org.bodies.get(org.positions.get(p.reportsToId)?.bodyId ?? "")?.shortName})</span> : null}</div>
                  <ul className="mt-1 space-y-1">
                    {assignments.filter((a) => a.positionId === p.id).map((a) => (
                      <li key={a.id} className="flex items-center justify-between"><span>👤 {names.get(a.userId)?.name}</span><form action={endAssignmentAction}><input type="hidden" name="id" value={a.id} /><SubmitButton className="btn-ghost btn-sm text-red-600" confirm="End this assignment? Open tasks in this body go to their supervisor; if they hold no other position they become alumni and are signed out.">Offboard</SubmitButton></form></li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <ActionForm action={assignAction} resetOnSuccess className="space-y-2 rounded-lg bg-gray-50 p-3">
                <div className="text-sm font-semibold">Assign a person</div>
                <select name="positionId" className="input">{selPositions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
                <select name="userId" className="input">{people.map((u) => <option key={u.id} value={u.id}>{u.name}{u.label ? ` — ${u.label}` : ""}</option>)}</select>
                <input name="startsOn" type="date" className="input" />
                <input name="reason" placeholder="Reason (required for MCP/MCVP approvals)" className="input" />
                <SubmitButton className="btn-secondary btn-sm">Assign</SubmitButton>
              </ActionForm>
              <ActionForm action={createPositionAction} resetOnSuccess className="space-y-2 rounded-lg bg-gray-50 p-3">
                <div className="text-sm font-semibold">Add a position</div>
                <input type="hidden" name="bodyId" value={sel.id} />
                <input name="title" placeholder="e.g. OCVP Finance" className="input" />
                <select name="roleKey" className="input">{ROLE_KEYS.map((r) => <option key={r}>{r}</option>)}</select>
                <select name="reportsToId" className="input"><option value="">Reports to — none</option>{positions.map((p) => <option key={p.id} value={p.id}>{p.title} · {org.bodies.get(p.bodyId)?.shortName ?? org.bodies.get(p.bodyId)?.name}</option>)}</select>
                <input name="purpose" placeholder="Purpose (JD)" className="input" />
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="isLeader" /> Leads this body</label>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="multiHolder" /> Several holders (members)</label>
                <SubmitButton className="btn-secondary btn-sm">Add position</SubmitButton>
              </ActionForm>
            </div>
          </Card>
        ) : <Card><p className="text-sm text-gray-500">Select a body on the left to manage positions and people.</p></Card>}
        <Card title="Create a body (LC, department, team, OC, project, synergy team…)">
          <ActionForm action={createBodyAction} resetOnSuccess className="grid gap-3 md:grid-cols-2">
            <Field label="Type"><select name="type" className="input" defaultValue="oc">{BODY_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Parent"><select name="parentId" className="input" defaultValue={sel?.id}>{bodies.map((b) => <option key={b.id} value={b.id}>{label(b.id) || b.name}</option>)}</select></Field>
            <Field label="Name"><input name="name" className="input" placeholder="e.g. Youth Speak Forum 2027 — OC" /></Field>
            <Field label="Short name"><input name="shortName" className="input" /></Field>
            <Field label="Department key" hint="OGX, ICX, BD, MKT, FNL, MX, IM, OD, EWA — picks the tracker template"><input name="departmentKey" className="input" /></Field>
            <Field label="Lineage key" hint="Same key across terms links archives (e.g. lc-dhaka-south-ogx)"><input name="lineageKey" className="input" /></Field>
            <Field label="Starts"><input name="startsOn" type="date" className="input" /></Field>
            <Field label="Ends"><input name="endsOn" type="date" className="input" /></Field>
            <Field label="Synergy / linked bodies" hint="Leaders of linked bodies can see this body's tracker"><select name="linkIds" multiple className="input h-24">{bodies.filter((b) => b.type === "department" || b.type === "team").map((b) => <option key={b.id} value={b.id}>{label(b.id)}</option>)}</select></Field>
            <div className="space-y-2"><Field label="Description"><input name="description" className="input" /></Field><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confidential" /> Confidential (members only — default for governance)</label></div>
            <div className="md:col-span-2"><SubmitButton>Create body</SubmitButton></div>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
