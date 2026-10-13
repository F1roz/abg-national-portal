import { revalidatePath } from "next/cache";
import { desc, eq, or } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { supervisorChain } from "@/lib/access";
import { internalPeople } from "@/lib/people";
import { usersByIds } from "@/lib/org";
import { notify } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { Card, Empty, Field, PageHeader, StatusBadge } from "@/components/ui";
import { ActionForm, SubmitButton, type FormState } from "@/components/forms";
import { fmtDate, optStr, str } from "@/lib/util";

export const metadata = { title: "Leave" };

const CATEGORIES = ["Exams", "Health", "Family", "Travel", "Personal", "Other"];

async function requestLeave(_: FormState, form: FormData): Promise<FormState> {
  "use server";
  const { actor, org } = await requireActor();
  const start = str(form, "startDate");
  const end = str(form, "endDate");
  if (!start || !end || end < start) return { error: "Choose a valid date range." };
  const approver = supervisorChain(org, actor.id)[0]?.[0];
  if (!approver) return { error: "No supervisor found in the structure — contact your MX team." };
  const [row] = await db.insert(s.leaveRequests).values({
    userId: actor.id, startDate: start, endDate: end, category: CATEGORIES.includes(str(form, "category")) ? str(form, "category") : "Other",
    reason: optStr(form, "reason"), handover: optStr(form, "handover"), backupUserId: optStr(form, "backupUserId"), approverId: approver,
  }).returning();
  await notify([approver], { type: "leave", priority: "important", title: `Leave request from ${actor.user.name}`, body: `${fmtDate(start)} → ${fmtDate(end)} · ${str(form, "category")}`, link: "/leave" });
  await audit(actor.id, "leave.requested", { type: "leave", id: row!.id });
  revalidatePath("/leave");
  return { ok: true, message: "Request sent to your supervisor." };
}

async function decide(form: FormData) {
  "use server";
  const { actor, org } = await requireActor();
  const [req] = await db.select().from(s.leaveRequests).where(eq(s.leaveRequests.id, str(form, "id")));
  if (!req || req.approverId !== actor.id || req.status !== "pending") return;
  const op = str(form, "op");
  if (op === "forward") {
    const next = supervisorChain(org, actor.id)[0]?.[0];
    if (next) {
      await db.update(s.leaveRequests).set({ approverId: next }).where(eq(s.leaveRequests.id, req.id));
      await notify([next], { type: "leave", priority: "important", title: `Leave request forwarded by ${actor.user.name}`, link: "/leave" });
    }
  } else {
    const status = op === "approve" ? "approved" : "rejected";
    await db.update(s.leaveRequests).set({ status, decidedById: actor.id, decidedAt: new Date(), decisionNote: optStr(form, "note") }).where(eq(s.leaveRequests.id, req.id));
    await notify([req.userId], { type: "leave", priority: "important", title: `Your leave request was ${status}`, body: str(form, "note") || undefined, link: "/leave" });
    if (status === "approved" && req.backupUserId) await notify([req.backupUserId], { type: "leave", title: `You are the backup for a colleague on leave ${fmtDate(req.startDate)} → ${fmtDate(req.endDate)}`, link: "/leave" });
    await audit(actor.id, `leave.${status}`, { type: "leave", id: req.id });
  }
  revalidatePath("/leave");
}

async function cancel(form: FormData) {
  "use server";
  const { actor } = await requireActor();
  const [req] = await db.select().from(s.leaveRequests).where(eq(s.leaveRequests.id, str(form, "id")));
  if (req?.userId === actor.id && req.status === "pending") await db.update(s.leaveRequests).set({ status: "cancelled" }).where(eq(s.leaveRequests.id, req.id));
  revalidatePath("/leave");
}

export default async function LeavePage() {
  const { actor, org } = await requireActor();
  const rows = await db.select().from(s.leaveRequests).where(or(eq(s.leaveRequests.userId, actor.id), eq(s.leaveRequests.approverId, actor.id))).orderBy(desc(s.leaveRequests.createdAt));
  const mine = rows.filter((r) => r.userId === actor.id);
  const toApprove = rows.filter((r) => r.approverId === actor.id && r.userId !== actor.id);
  const people = await usersByIds(rows.flatMap((r) => [r.userId, r.approverId, r.backupUserId]).filter((x): x is string => !!x));
  const peopleList = (await internalPeople(org)).filter((p) => p.id !== actor.id);
  const approver = supervisorChain(org, actor.id)[0]?.[0];
  const approverName = approver ? (await usersByIds([approver])).get(approver)?.name : null;
  return (
    <>
      <PageHeader title="🏖 Leave" subtitle={approverName ? `Your requests go to ${approverName}, who can approve or forward them up the chain.` : "Leave requests follow your reporting line."} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Request leave">
          <ActionForm action={requestLeave} resetOnSuccess>
            <div className="grid grid-cols-2 gap-2"><Field label="From"><input name="startDate" type="date" required className="input" /></Field><Field label="To"><input name="endDate" type="date" required className="input" /></Field></div>
            <Field label="Category"><select name="category" className="input">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Reason (visible to approvers only)"><textarea name="reason" rows={2} className="input" /></Field>
            <Field label="Handover"><textarea name="handover" rows={2} className="input" placeholder="What's covered while you're away?" /></Field>
            <Field label="Backup person"><select name="backupUserId" className="input"><option value="">—</option>{peopleList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <SubmitButton>Send request</SubmitButton>
          </ActionForm>
        </Card>
        <div className="space-y-6 lg:col-span-2">
          {toApprove.length ? (
            <Card title={`Waiting for my decision (${toApprove.filter((r) => r.status === "pending").length})`}>
              <ul className="divide-y divide-gray-100">
                {toApprove.map((r) => (
                  <li key={r.id} className="py-3 text-sm">
                    <div className="flex justify-between"><strong>{people.get(r.userId)?.name}</strong><StatusBadge status={r.status} /></div>
                    <div>{fmtDate(r.startDate)} → {fmtDate(r.endDate)} · {r.category}{r.backupUserId ? ` · backup ${people.get(r.backupUserId)?.name}` : ""}</div>
                    {r.reason ? <div className="text-gray-600">{r.reason}</div> : null}
                    {r.handover ? <div className="text-xs text-gray-500">Handover: {r.handover}</div> : null}
                    {r.status === "pending" ? (
                      <form action={decide} className="mt-2 flex flex-wrap gap-2">
                        <input type="hidden" name="id" value={r.id} />
                        <input name="note" placeholder="Note (optional)" className="input max-w-xs" />
                        <button name="op" value="approve" className="btn-primary btn-sm">Approve</button>
                        <button name="op" value="reject" className="btn-danger btn-sm">Reject</button>
                        <button name="op" value="forward" className="btn-secondary btn-sm">Forward up</button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card title="My requests" bodyClass="p-0">
            {mine.length ? (
              <table className="table">
                <thead><tr><th>Dates</th><th>Category</th><th>Approver</th><th>Status</th><th /></tr></thead>
                <tbody>{mine.map((r) => (
                  <tr key={r.id}><td>{fmtDate(r.startDate)} → {fmtDate(r.endDate)}</td><td>{r.category}</td><td>{people.get(r.approverId ?? "")?.name}</td><td><StatusBadge status={r.status} />{r.decisionNote ? <div className="text-xs text-gray-500">{r.decisionNote}</div> : null}</td>
                    <td>{r.status === "pending" ? <form action={cancel}><input type="hidden" name="id" value={r.id} /><button className="btn-ghost btn-sm">Cancel</button></form> : null}</td></tr>
                ))}</tbody>
              </table>
            ) : <div className="p-4"><Empty>No leave requests.</Empty></div>}
          </Card>
        </div>
      </div>
    </>
  );
}
