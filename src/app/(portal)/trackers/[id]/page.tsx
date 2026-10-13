import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, s } from "@/db";
import type { TrackerColumn } from "@/db/schema";
import { requireActor } from "@/lib/session";
import { canContributeToBody, canManageBody, canViewBodyWork, usersInSubtree } from "@/lib/access";
import { applyRollup } from "@/lib/kpi";
import { bodyPath, usersByIds } from "@/lib/org";
import { internalPeople } from "@/lib/people";
import { Badge, Card, Empty, Field, Notice, PageHeader, Stat } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { fmtDate, fmtDateTime } from "@/lib/util";
import { addColumnAction, addRowAction, deleteRowAction, removeColumnAction, updateRowAction } from "../actions";

export const metadata = { title: "Tracker" };

function Input({ c, value, people }: { c: TrackerColumn; value?: string | number | null; people: { id: string; name: string }[] }) {
  const name = `c_${c.key}`;
  const v = value === null || value === undefined ? "" : String(value);
  if (c.type === "select") return (<select name={name} defaultValue={v} className="input" required={c.required}><option value="">—</option>{c.options?.map((o) => <option key={o}>{o}</option>)}</select>);
  if (c.type === "user") return (<select name={name} defaultValue={v} className="input"><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>);
  return <input name={name} defaultValue={v} required={c.required} type={c.type === "date" ? "date" : c.type === "number" || c.type === "currency" ? "number" : c.type === "url" ? "url" : "text"} step="any" className="input" />;
}

export default async function TrackerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; sort?: string; f?: string; v?: string }> }) {
  const { id } = await params;
  const { edit, sort, f, v } = await searchParams;
  const { actor, org } = await requireActor();
  const [tracker] = await db.select().from(s.trackers).where(eq(s.trackers.id, id));
  if (!tracker || !canViewBodyWork(actor, org, tracker.bodyId)) notFound();
  let rows = await db.select().from(s.trackerRows).where(eq(s.trackerRows.trackerId, id)).orderBy(asc(s.trackerRows.createdAt));
  const allRows = rows;
  if (f && v) rows = rows.filter((r) => String(r.data[f] ?? "") === v);
  if (sort) rows = [...rows].sort((a, b) => String(a.data[sort] ?? "").localeCompare(String(b.data[sort] ?? ""), undefined, { numeric: true }));
  const body = org.bodies.get(tracker.bodyId)!;
  const manager = canManageBody(actor, org, tracker.bodyId);
  const contributor = canContributeToBody(actor, org, tracker.bodyId);
  const userKeys = tracker.columns.filter((c) => c.type === "user").map((c) => c.key);
  const people = await usersByIds(rows.flatMap((r) => [...userKeys.map((k) => r.data[k]), r.updatedById]).filter((x): x is string => typeof x === "string"));
  const candidates = contributor && !tracker.frozen ? (body.termId === org.termId ? (await internalPeople(org)).filter((p) => usersInSubtree(org, body.parentId && body.type === "team" ? body.parentId : body.id).has(p.id) || p.id === actor.id) : []) : [];
  const peopleOptions = candidates.length ? candidates : [{ id: actor.id, name: actor.user.name }];
  const editing = edit ? rows.find((r) => r.id === edit) : undefined;
  const selectCols = tracker.columns.filter((c) => c.type === "select");
  const show = (c: TrackerColumn, val: string | number | null | undefined) => {
    if (val === null || val === undefined || val === "") return <span className="text-gray-300">—</span>;
    if (c.type === "user") return people.get(String(val))?.name ?? "—";
    if (c.type === "currency") return `৳ ${Number(val).toLocaleString("en-IN")}`;
    if (c.type === "date") return fmtDate(String(val));
    if (c.type === "url") return <a href={String(val)} className="link" target="_blank" rel="noreferrer noopener">link</a>;
    if (c.type === "select") return <Badge tone={/won|done|approved|realised|finished|received|paid|compliant|resolved/i.test(String(val)) ? "green" : /lost|overdue|blocked|non-compliant|at risk|delayed|critical/i.test(String(val)) ? "red" : "gray"}>{String(val)}</Badge>;
    return String(val);
  };

  return (
    <>
      <PageHeader
        title={tracker.name}
        subtitle={<><Link className="link" href={`/bodies/${body.id}`}>{bodyPath(org, body.id) || body.name}</Link>{tracker.description ? ` · ${tracker.description}` : ""}</>}
        actions={<a className="btn-secondary" href={`/api/trackers/${id}/export`}>⬇ Export CSV</a>}
      />
      {tracker.frozen ? <Notice tone="yellow">🗄️ Archived snapshot — frozen {fmtDate(tracker.frozenAt)} when the term closed. Read-only.</Notice> : !contributor ? <Notice>👁 You have read access{actor.isMC ? " as MC" : ""}. Members and leaders of this body update it.</Notice> : null}

      {tracker.rollups.length ? (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {tracker.rollups.map((r, i) => <Stat key={i} label={r.label} value={applyRollup(allRows, r).toLocaleString("en-IN")} />)}
        </div>
      ) : null}

      {selectCols.length ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-gray-500">Filter:</span>
          <Link href={`/trackers/${id}`} className={`rounded-full px-2.5 py-0.5 ${!f ? "bg-brand text-white" : "bg-white ring-1 ring-gray-200"}`}>All ({allRows.length})</Link>
          {selectCols[0]!.options?.map((o) => {
            const n = allRows.filter((r) => r.data[selectCols[0]!.key] === o).length;
            return n ? <Link key={o} href={`/trackers/${id}?f=${selectCols[0]!.key}&v=${encodeURIComponent(o)}`} className={`rounded-full px-2.5 py-0.5 ${v === o ? "bg-brand text-white" : "bg-white ring-1 ring-gray-200"}`}>{o} ({n})</Link> : null;
          })}
        </div>
      ) : null}

      <Card bodyClass="p-0" className="mb-6">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  {tracker.columns.map((c) => <th key={c.key}><Link href={`/trackers/${id}?sort=${c.key}`}>{c.label}</Link></th>)}
                  <th>Updated</th>{!tracker.frozen && contributor ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    {tracker.columns.map((c) => <td key={c.key} className="max-w-[260px]">{show(c, r.data[c.key])}</td>)}
                    <td className="whitespace-nowrap text-xs text-gray-500">{fmtDateTime(r.updatedAt)}<br />{r.updatedById ? people.get(r.updatedById)?.name : ""}</td>
                    {!tracker.frozen && contributor ? (
                      <td className="whitespace-nowrap">
                        {manager || r.ownerId === actor.id || r.createdById === actor.id ? <Link href={`/trackers/${id}?edit=${r.id}#edit`} className="btn-ghost btn-sm">Edit</Link> : null}
                        {manager || r.createdById === actor.id ? (
                          <form action={deleteRowAction} className="inline"><input type="hidden" name="trackerId" value={id} /><input type="hidden" name="rowId" value={r.id} /><SubmitButton className="btn-ghost btn-sm text-red-600" confirm="Delete this row?">✕</SubmitButton></form>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="p-4"><Empty>No rows yet.</Empty></div>}
      </Card>

      {!tracker.frozen && contributor ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title={editing ? "Edit row" : "Add a row"} className="lg:col-span-2">
            <div id="edit" />
            <ActionForm action={editing ? updateRowAction : addRowAction} resetOnSuccess={!editing} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="trackerId" value={id} />
              {editing ? <input type="hidden" name="rowId" value={editing.id} /> : null}
              {tracker.columns.map((c) => (
                <Field key={c.key} label={`${c.label}${c.required ? " *" : ""}`}><Input c={c} value={editing?.data[c.key] ?? (c.key === "owner" ? actor.id : undefined)} people={peopleOptions} /></Field>
              ))}
              <div className="flex gap-2 sm:col-span-2">
                <SubmitButton>{editing ? "Save changes" : "Add row"}</SubmitButton>
                {editing ? <Link href={`/trackers/${id}`} className="btn-ghost">Cancel</Link> : null}
              </div>
            </ActionForm>
          </Card>
          {manager ? (
            <Card title="Columns (leaders)">
              <ul className="mb-3 space-y-1 text-sm">
                {tracker.columns.map((c) => (
                  <li key={c.key} className="flex items-center justify-between">
                    <span>{c.label} <span className="text-xs text-gray-400">{c.type}</span></span>
                    {!tracker.rollups.some((r) => r.column === c.key || r.where?.column === c.key) ? (
                      <form action={removeColumnAction}><input type="hidden" name="trackerId" value={id} /><input type="hidden" name="key" value={c.key} /><SubmitButton className="btn-ghost btn-sm text-red-600" confirm={`Remove column ${c.label}? Existing values are hidden.`}>remove</SubmitButton></form>
                    ) : <span className="text-xs text-gray-400">used by KPI</span>}
                  </li>
                ))}
              </ul>
              <ActionForm action={addColumnAction} resetOnSuccess>
                <input type="hidden" name="trackerId" value={id} />
                <input name="label" placeholder="New column name" className="input" />
                <select name="type" className="input"><option value="text">Text</option><option value="number">Number</option><option value="currency">Currency (BDT)</option><option value="date">Date</option><option value="select">Choice</option><option value="user">Person</option><option value="url">Link</option></select>
                <input name="options" placeholder="Choices, comma separated (for Choice)" className="input" />
                <SubmitButton className="btn-secondary btn-sm">Add column</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
