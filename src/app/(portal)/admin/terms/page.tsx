import { desc } from "drizzle-orm";
import { db, s } from "@/db";
import { requireFullAdmin } from "../guard";
import { Card, Field, StatusBadge } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { fmtDate } from "@/lib/util";
import { activateTermAction, closeTermAction, createTermAction } from "../actions";

export default async function TermsAdmin() {
  await requireFullAdmin();
  const terms = await db.select().from(s.terms).orderBy(desc(s.terms.startsOn));
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Terms" className="lg:col-span-2" bodyClass="p-0">
        <table className="table">
          <thead><tr><th>Term</th><th>Dates</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{terms.map((t) => (
            <tr key={t.id}>
              <td className="font-semibold">{t.code}</td><td className="text-xs">{fmtDate(t.startsOn)} – {fmtDate(t.endsOn)}</td><td><StatusBadge status={t.status} /></td>
              <td className="space-y-2">
                {t.status === "planning" ? (
                  <form action={activateTermAction} className="flex flex-wrap items-center gap-2"><input type="hidden" name="id" value={t.id} /><label className="text-xs"><input type="checkbox" name="closeCurrent" defaultChecked /> close & archive current term</label><SubmitButton className="btn-primary btn-sm" confirm={`Make ${t.code} the active term?`}>Activate</SubmitButton></form>
                ) : null}
                {t.status === "active" ? (
                  <form action={closeTermAction} className="flex flex-wrap items-center gap-2"><input type="hidden" name="id" value={t.id} /><input name="confirm" placeholder="type CLOSE" className="input w-28 py-1" /><SubmitButton className="btn-danger btn-sm">Close & archive</SubmitButton></form>
                ) : null}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
      <Card title="New term">
        <ActionForm action={createTermAction}>
          <Field label="Code"><input name="code" placeholder="27.28" className="input" /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Starts"><input name="startsOn" type="date" required className="input" /></Field><Field label="Ends"><input name="endsOn" type="date" required className="input" /></Field></div>
          <Field label="Copy structure from" hint="Bodies, positions, reporting lines and fresh trackers/KPIs. Not people."><select name="cloneFrom" className="input"><option value="">— empty term —</option>{terms.map((t) => <option key={t.id} value={t.id}>{t.code}</option>)}</select></Field>
          <SubmitButton>Create term</SubmitButton>
        </ActionForm>
        <p className="mt-3 text-xs text-gray-500">Closing a term freezes all trackers as read-only snapshots, closes bodies, ends assignments, moves people without a new position to alumni, and keeps every document and number in the archive.</p>
      </Card>
    </div>
  );
}
