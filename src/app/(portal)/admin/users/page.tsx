import { desc } from "drizzle-orm";
import { db, s } from "@/db";
import { requireFullAdmin } from "../guard";
import { positionLabels } from "@/lib/org";
import { Badge, Card, Field, StatusBadge } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { createUserAction, sendResetAction, setUserStatusAction } from "../actions";

export default async function UsersAdmin({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { actor, org } = await requireFullAdmin();
  const { q = "" } = await searchParams;
  const users = (await db.select().from(s.users).orderBy(desc(s.users.createdAt))).filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title={`Users (${users.length})`} className="lg:col-span-2" bodyClass="p-0" actions={<form><input name="q" defaultValue={q} placeholder="Search" className="input py-1" /></form>}>
        <div className="max-h-[70vh] overflow-auto">
          <table className="table">
            <thead><tr><th>User</th><th>Type</th><th>Status</th><th>MFA</th><th /></tr></thead>
            <tbody>{users.map((u) => (
              <tr key={u.id}>
                <td><div className="font-medium">{u.name}</div><div className="text-xs text-gray-500">{u.email} · {positionLabels(org, u.id)[0] ?? "—"}</div></td>
                <td><Badge>{u.userType}</Badge></td><td><StatusBadge status={u.status} /></td><td>{u.mfaEnabled ? "✅" : "—"}</td>
                <td className="whitespace-nowrap">
                  {u.id !== actor.id ? (
                    <form action={setUserStatusAction} className="inline-flex gap-1"><input type="hidden" name="id" value={u.id} />
                      {u.status === "suspended" ? <button name="status" value="active" className="btn-ghost btn-sm">Reactivate</button> : <button name="status" value="suspended" className="btn-ghost btn-sm text-red-600">Suspend</button>}
                      {u.status !== "archived" ? <button name="status" value="archived" className="btn-ghost btn-sm">Archive</button> : null}
                    </form>
                  ) : null}
                  <form action={sendResetAction} className="inline"><input type="hidden" name="id" value={u.id} /><button className="btn-ghost btn-sm">Send link</button></form>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
      <Card title="Create an account directly">
        <ActionForm action={createUserAction} resetOnSuccess>
          <Field label="Name"><input name="name" className="input" /></Field>
          <Field label="Email"><input name="email" type="email" className="input" /></Field>
          <Field label="Account type"><select name="userType" className="input"><option value="internal">Internal (member)</option><option value="boa">Board of Advisors (external)</option><option value="partner">Partner (external)</option></select></Field>
          <SubmitButton>Create & send activation</SubmitButton>
        </ActionForm>
        <p className="mt-3 text-xs text-gray-500">New members normally join through Recruitment (offer → NDA → account). Accounts start with no permissions until a position is assigned. Passwords are never sent by email — only single-use activation links.</p>
      </Card>
    </div>
  );
}
