import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, s } from "@/db";
import { SYSTEM_ROLES } from "@/db/schema";
import { requireFullAdmin } from "../guard";
import { internalPeople } from "@/lib/people";
import { usersByIds } from "@/lib/org";
import { Badge, Card, Field, StatusBadge } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { fmtDateTime } from "@/lib/util";
import { decideApprovalAction, requestApprovalAction } from "../actions";

export default async function RolesAdmin() {
  const { actor, org } = await requireFullAdmin();
  const roles = await db.select().from(s.systemRoles);
  const requests = await db.select().from(s.approvalRequests).orderBy(desc(s.approvalRequests.createdAt)).limit(50);
  const people = await usersByIds([...roles.map((r) => r.userId), ...requests.flatMap((r) => [r.requestedById, r.decidedById, r.payload.userId]).filter((x): x is string => !!x)]);
  const all = await internalPeople(org);
  const describe = (r: (typeof requests)[number]) =>
    r.action === "bulk_export" ? `Bulk export: ${r.payload.dataset}` : r.action === "assign_position" ? `Assign ${org.positions.get(r.payload.positionId ?? "")?.title} → ${people.get(r.payload.userId ?? "")?.name}` : `${r.action === "grant_system_role" ? "Grant" : "Revoke"} ${r.payload.role} → ${people.get(r.payload.userId ?? "")?.name}`;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card title="System roles (separation of duties — no single see-everything account)" bodyClass="p-0">
          <table className="table"><thead><tr><th>Person</th><th>Role</th><th>Granted</th></tr></thead>
            <tbody>{roles.map((r) => <tr key={`${r.userId}${r.role}`}><td>{people.get(r.userId)?.name}</td><td><Badge tone="purple">{r.role}</Badge></td><td className="text-xs">{fmtDateTime(r.createdAt)}</td></tr>)}</tbody>
          </table>
        </Card>
        <Card title="Approval requests (two-person rule)" bodyClass="p-0">
          <table className="table"><thead><tr><th>Request</th><th>By</th><th>Status</th><th /></tr></thead>
            <tbody>{requests.map((r) => (
              <tr key={r.id}>
                <td>{describe(r)}<div className="text-xs text-gray-500">“{r.reason}” · {fmtDateTime(r.createdAt)}</div></td>
                <td className="text-xs">{people.get(r.requestedById)?.name}{r.decidedById ? <div>decided by {people.get(r.decidedById)?.name}</div> : null}</td>
                <td><StatusBadge status={r.status} /></td>
                <td className="whitespace-nowrap">
                  {r.status === "pending" && r.requestedById !== actor.id ? (
                    <form action={decideApprovalAction} className="flex gap-1"><input type="hidden" name="id" value={r.id} /><button name="op" value="approve" className="btn-primary btn-sm">Approve</button><button name="op" value="reject" className="btn-ghost btn-sm">Reject</button></form>
                  ) : r.status === "pending" ? <span className="text-xs text-gray-400">awaiting another admin</span> : null}
                  {r.action === "bulk_export" && r.status === "approved" && r.requestedById === actor.id ? <Link className="link text-sm" href={`/api/exports/${r.id}`}>Download (once)</Link> : null}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      </div>
      <div className="space-y-6">
        <Card title="Request a role change">
          <ActionForm action={requestApprovalAction} resetOnSuccess>
            <Field label="Action"><select name="action" className="input"><option value="grant_system_role">Grant role</option><option value="revoke_system_role">Revoke role</option></select></Field>
            <Field label="Person"><select name="userId" className="input">{all.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Role"><select name="role" className="input">{SYSTEM_ROLES.map((r) => <option key={r}>{r}</option>)}</select></Field>
            <Field label="Reason"><input name="reason" className="input" /></Field>
            <SubmitButton>Request</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Request a bulk export">
          <ActionForm action={requestApprovalAction} resetOnSuccess>
            <input type="hidden" name="action" value="bulk_export" />
            <Field label="Dataset"><select name="dataset" className="input"><option value="directory">Member directory (no private fields)</option><option value="kpis">All KPIs this term</option></select></Field>
            <Field label="Why do you need it?"><input name="reason" className="input" /></Field>
            <SubmitButton>Request export</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
