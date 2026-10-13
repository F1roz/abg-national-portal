import { eq } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { canContributeToBody } from "@/lib/access";
import { assignablePeople } from "@/lib/people";
import { bodyPath } from "@/lib/org";
import { Card, Field, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { createTaskAction } from "../actions";

export const metadata = { title: "New task" };

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<{ assignee?: string }> }) {
  const { actor, org } = await requireActor();
  const { assignee } = await searchParams;
  const people = await assignablePeople(actor, org);
  const bodies = [...org.bodies.values()].filter((b) => b.termId === org.termId && b.type !== "entity" && canContributeToBody(actor, org, b.id));
  // Team KPIs of bodies I work in + individual KPIs of the people I can assign to.
  const peopleIds = people.map((p) => p.id);
  const kpis = (await db.select().from(s.kpis).where(eq(s.kpis.termId, org.termId))).filter((k) =>
    k.userId ? peopleIds.includes(k.userId) : bodies.some((b) => b.id === k.bodyId),
  );
  const projects = [...org.bodies.values()].filter((b) => b.termId === org.termId && b.type === "project");

  return (
    <>
      <PageHeader title="New task" subtitle={actor.isMC ? "As MC you can assign to anyone. Tick “notify the chain” to keep intermediate leaders informed." : "You can assign to yourself and to people in the teams you lead."} />
      <Card className="max-w-3xl">
        <ActionForm action={createTaskAction}>
          <Field label="Title *"><input name="title" required className="input" placeholder="e.g. Submit weekly LC pipeline report" /></Field>
          <Field label="Description"><textarea name="description" rows={3} className="input" /></Field>
          <Field label="Assign to *" hint="Hold Ctrl / Cmd to select several people — each gets their own task.">
            <select name="assigneeIds" multiple required className="input h-40" defaultValue={assignee ? [assignee] : [actor.id]}>
              {people.map((p) => (<option key={p.id} value={p.id}>{p.id === actor.id ? "Me" : p.name}{p.label ? ` — ${p.label}` : ""}</option>))}
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Deadline"><input name="dueAt" type="datetime-local" className="input" /></Field>
            <Field label="Priority">
              <select name="priority" className="input" defaultValue="medium">
                <option value="low">🔵 Low</option><option value="medium">🟡 Medium</option><option value="high">🟠 High</option><option value="critical">🔴 Critical</option>
              </select>
            </Field>
            <Field label="Reviewer" hint="Defaults to you">
              <select name="reviewerId" className="input" defaultValue="">
                <option value="">Me (assigner)</option>
                {people.filter((p) => p.id !== actor.id).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Body / team" hint="Defaults to the assignee's team">
              <select name="bodyId" className="input" defaultValue="">
                <option value="">Automatic</option>
                {bodies.map((b) => (<option key={b.id} value={b.id}>{bodyPath(org, b.id)}</option>))}
              </select>
            </Field>
            <Field label="Project">
              <select name="projectId" className="input" defaultValue="">
                <option value="">—</option>
                {projects.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
              </select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Contributes to KPI" hint="When completed, the KPI is credited automatically.">
              <select name="kpiId" className="input" defaultValue="">
                <option value="">—</option>
                {kpis.map((k) => (<option key={k.id} value={k.id}>{k.userId ? "Individual" : org.bodies.get(k.bodyId)?.shortName ?? ""} · {k.name}</option>))}
              </select>
            </Field>
            <Field label="Contribution"><input name="kpiContribution" type="number" min={0} step="any" className="input" placeholder="+20" /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="requireAck" /> Require acknowledgement (“I acknowledge this task”)</label>
          {actor.isMC || actor.isLeader ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="notifyChain" /> Notify the leaders between me and the assignee</label> : null}
          <SubmitButton>Assign task</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
