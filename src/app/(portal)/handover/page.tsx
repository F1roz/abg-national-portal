import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, notInArray, or } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { leadsBody, subtreeOf } from "@/lib/access";
import { internalPeople } from "@/lib/people";
import { usersByIds } from "@/lib/org";
import { notify } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { logTask } from "@/lib/tasks";
import { Card, Empty, Field, PageHeader, StatusBadge } from "@/components/ui";
import { ActionForm, SubmitButton, type FormState } from "@/components/forms";
import { fmtDate, optStr, str } from "@/lib/util";

export const metadata = { title: "Handover" };

const CHECKLIST = [
  ["jd", "JD reviewed and updated"], ["kpi", "KPIs, targets and current numbers"], ["stakeholders", "Stakeholders & partner contacts"], ["projects", "Ongoing projects"],
  ["access", "Account access transferred through approved mechanisms (never share passwords in chat)"], ["documents", "Documents moved to the portal"], ["risks", "Open risks"],
  ["lessons", "Lessons learned written as a case"], ["contacts", "Key contacts"], ["tasks", "Pending tasks listed"], ["recommendations", "Strategic recommendations"],
] as const;

async function create(_: FormState, form: FormData): Promise<FormState> {
  "use server";
  const { actor } = await requireActor();
  const positionId = str(form, "positionId");
  if (!actor.positions.some((p) => p.position.id === positionId)) return { error: "Choose one of your positions." };
  const checklist = CHECKLIST.map(([key, label]) => ({ key, label, done: form.get(`c_${key}`) === "on", notes: str(form, `n_${key}`) || undefined }));
  const submit = form.get("submit") === "1";
  const [h] = await db.insert(s.handovers).values({ positionId, fromUserId: actor.id, toUserId: optStr(form, "toUserId"), checklist, notes: optStr(form, "notes"), status: submit ? "submitted" : "draft", submittedAt: submit ? new Date() : null }).returning();
  if (submit && h!.toUserId) await notify([h!.toUserId], { type: "onboarding", priority: "important", title: `${actor.user.name} sent you a handover`, body: "Review and accept it in the portal.", link: "/handover" });
  await audit(actor.id, "handover.created", { type: "handover", id: h!.id }, { submitted: submit });
  revalidatePath("/handover");
  return { ok: true, message: submit ? "Handover submitted to your successor." : "Draft saved." };
}

async function accept(form: FormData) {
  "use server";
  const { actor, org } = await requireActor();
  const [h] = await db.select().from(s.handovers).where(eq(s.handovers.id, str(form, "id")));
  if (!h || h.toUserId !== actor.id || h.status !== "submitted") return;
  await db.update(s.handovers).set({ status: "accepted", acceptedAt: new Date() }).where(eq(s.handovers.id, h.id));
  // Transfer the outgoing leader's open tasks inside this position's body to the successor.
  const pos = org.positions.get(h.positionId);
  if (pos && form.get("transfer") === "on") {
    const scope = [...subtreeOf(org, pos.bodyId)];
    const open = await db.select().from(s.tasks).where(and(eq(s.tasks.assigneeId, h.fromUserId), inArray(s.tasks.bodyId, scope), notInArray(s.tasks.status, ["completed", "rejected"])));
    for (const t of open) {
      await db.update(s.tasks).set({ assigneeId: actor.id }).where(eq(s.tasks.id, t.id));
      await logTask(t.id, actor.id, "reassigned", `Transferred to ${actor.user.name} through handover`);
    }
  }
  await notify([h.fromUserId], { type: "onboarding", title: `${actor.user.name} accepted your handover`, link: "/handover" });
  await audit(actor.id, "handover.accepted", { type: "handover", id: h.id });
  revalidatePath("/handover");
}

export default async function HandoverPage() {
  const { actor, org } = await requireActor();
  const all = await db.select().from(s.handovers).orderBy(desc(s.handovers.createdAt));
  const visible = all.filter((h) => h.fromUserId === actor.id || h.toUserId === actor.id || actor.isMC || (org.positions.get(h.positionId) && leadsBody(actor, org, org.positions.get(h.positionId)!.bodyId)));
  const people = await usersByIds(visible.flatMap((h) => [h.fromUserId, h.toUserId]).filter((x): x is string => !!x));
  const successors = (await internalPeople(org)).filter((p) => p.id !== actor.id);
  return (
    <>
      <PageHeader title="🤝 Term handover" subtitle="Outgoing leaders hand over with a checklist; incoming leaders review and accept. Nothing starts from zero." />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Create a handover" className="lg:col-span-3">
          {actor.positions.length ? (
            <ActionForm action={create}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Position"><select name="positionId" className="input">{actor.positions.map((p) => <option key={p.position.id} value={p.position.id}>{p.position.title} · {p.body.name}</option>)}</select></Field>
                <Field label="Successor"><select name="toUserId" className="input"><option value="">— not yet known —</option>{successors.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              </div>
              <ul className="space-y-2">
                {CHECKLIST.map(([k, label]) => (
                  <li key={k} className="grid gap-1 sm:grid-cols-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name={`c_${k}`} /> {label}</label><input name={`n_${k}`} placeholder="Notes / link" className="input py-1" /></li>
                ))}
              </ul>
              <Field label="Overall notes & recommendations"><textarea name="notes" rows={3} className="input" /></Field>
              <div className="flex gap-2"><SubmitButton className="btn-secondary">Save draft</SubmitButton><button name="submit" value="1" className="btn-primary">Submit to successor</button></div>
            </ActionForm>
          ) : <Empty>You hold no position this term.</Empty>}
        </Card>
        <Card title="Handovers" className="lg:col-span-2">
          {visible.length ? (
            <ul className="space-y-4">
              {visible.map((h) => {
                const pos = org.positions.get(h.positionId);
                const done = h.checklist.filter((c) => c.done).length;
                return (
                  <li key={h.id} className="text-sm">
                    <div className="flex justify-between"><strong>{pos?.title}</strong><StatusBadge status={h.status} /></div>
                    <div className="text-gray-600">{people.get(h.fromUserId)?.name} → {people.get(h.toUserId ?? "")?.name ?? "TBD"} · {fmtDate(h.createdAt)}</div>
                    <div className="text-xs text-gray-500">{done}/{h.checklist.length} checklist items</div>
                    <details className="mt-1"><summary className="cursor-pointer text-xs text-brand">View</summary>
                      <ul className="mt-1 space-y-0.5 text-xs">{h.checklist.map((c) => <li key={c.key}>{c.done ? "☑" : "☐"} {c.label}{c.notes ? ` — ${c.notes}` : ""}</li>)}</ul>
                      {h.notes ? <p className="mt-1 whitespace-pre-wrap text-xs">{h.notes}</p> : null}
                    </details>
                    {h.toUserId === actor.id && h.status === "submitted" ? (
                      <form action={accept} className="mt-2 space-y-1"><input type="hidden" name="id" value={h.id} /><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="transfer" defaultChecked /> Transfer their open tasks in this body to me</label><SubmitButton className="btn-primary btn-sm">Accept handover</SubmitButton></form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : <Empty>No handovers yet.</Empty>}
        </Card>
      </div>
    </>
  );
}
