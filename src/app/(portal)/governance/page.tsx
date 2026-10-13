import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { canManageBody, canViewBodyWork, holdersOfBody } from "@/lib/access";
import { internalPeople } from "@/lib/people";
import { usersByIds, bodyPath } from "@/lib/org";
import { Badge, Card, Empty, Field, PageHeader, StatusBadge } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { fmtDate, fmtDateTime } from "@/lib/util";
import { closeMotionAction, createDecisionAction, createMotionAction, decisionStatusAction, voteAction } from "./actions";

export const metadata = { title: "Governance" };

export default async function GovernancePage() {
  const { actor, org } = await requireActor();
  const motions = (await db.select().from(s.motions).orderBy(desc(s.motions.createdAt))).filter((m) => canViewBodyWork(actor, org, m.bodyId) || actor.isMCP);
  const votes = motions.length ? await db.select().from(s.votes).where(inArray(s.votes.motionId, motions.map((m) => m.id))) : [];
  const decisions = (await db.select().from(s.decisions).orderBy(desc(s.decisions.decidedOn))).filter((d) => canViewBodyWork(actor, org, d.bodyId));
  const people = await usersByIds([...votes.map((v) => v.userId), ...decisions.flatMap((d) => [d.decidedById, d.responsibleId]).filter((x): x is string => !!x)]);
  const termCodes = new Map((await db.select().from(s.terms)).map((t) => [t.id, t.code]));
  const chairOf = [...org.bodies.values()].filter((b) => b.termId === org.termId && (b.type === "governance" || b.type === "mc") && (actor.ledBodyIds.has(b.id) || actor.system.has("governance_admin")));
  const decisionBodies = [...org.bodies.values()].filter((b) => b.termId === org.termId && canManageBody(actor, org, b.id) && ["mc", "lc", "governance", "department", "oc", "project"].includes(b.type));
  const peopleList = decisionBodies.length ? await internalPeople(org) : [];
  const now = new Date();

  return (
    <>
      <PageHeader title="⚖️ Governance" subtitle="Motions & digital voting for ECB / ESC / EFB / MC, and the decision log that future MCPs inherit." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <h2 className="font-semibold">Motions</h2>
          {motions.length ? motions.map((m) => {
            const mv = votes.filter((v) => v.motionId === m.id);
            const eligible = holdersOfBody(org, m.bodyId);
            const mine = mv.find((v) => v.userId === actor.id);
            const canVote = m.status === "open" && m.closesAt > now && eligible.includes(actor.id) && !mine;
            const chair = actor.ledBodyIds.has(m.bodyId) || actor.system.has("governance_admin");
            return (
              <Card key={m.id}>
                <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-gray-500">{m.code}</span><StatusBadge status={m.status} /><Badge>{org.bodies.get(m.bodyId)?.shortName}</Badge></div>
                <h3 className="mt-1 font-semibold">{m.title}</h3>
                {m.description ? <p className="text-sm text-gray-600">{m.description}</p> : null}
                <div className="mt-2 text-xs text-gray-500">Closes {fmtDateTime(m.closesAt)} · quorum {m.quorum} · {mv.length}/{eligible.length} voted</div>
                {m.status !== "open" || chair || mine ? (
                  <div className="mt-2 text-sm">🟢 {mv.filter((v) => v.choice === "approve").length} approve · 🔴 {mv.filter((v) => v.choice === "reject").length} reject · 🟡 {mv.filter((v) => v.choice === "abstain").length} abstain</div>
                ) : null}
                {(chair || m.status !== "open") && mv.length ? <div className="mt-1 text-xs text-gray-500">Voted: {mv.map((v) => `${people.get(v.userId)?.name} (${v.choice}, ${fmtDateTime(v.castAt)})`).join(" · ")}</div> : null}
                {mine ? <div className="mt-2 text-sm text-green-700">You voted: {mine.choice}</div> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {canVote ? (["approve", "reject", "abstain"] as const).map((c) => (
                    <form key={c} action={voteAction}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="choice" value={c} /><SubmitButton className={c === "approve" ? "btn-primary btn-sm" : c === "reject" ? "btn-danger btn-sm" : "btn-secondary btn-sm"} confirm={`Cast "${c}"? Votes are final.`}>{c === "approve" ? "🟢 Approve" : c === "reject" ? "🔴 Reject" : "🟡 Abstain"}</SubmitButton></form>
                  )) : null}
                  {chair && m.status === "open" ? <form action={closeMotionAction}><input type="hidden" name="id" value={m.id} /><SubmitButton className="btn-secondary btn-sm" confirm="Close voting and record the result?">Close & tally</SubmitButton></form> : null}
                </div>
              </Card>
            );
          }) : <Card><Empty>No motions you can see.</Empty></Card>}

          <h2 className="pt-4 font-semibold">Decision log</h2>
          <Card bodyClass="p-0">
            {decisions.length ? (
              <table className="table">
                <thead><tr><th>Decision</th><th>Body</th><th>Responsible</th><th>Status</th></tr></thead>
                <tbody>{decisions.map((d) => (
                  <tr key={d.id}>
                    <td><span className="font-mono text-xs text-gray-500">{d.code}</span><div className="font-medium">{d.title}</div><div className="text-xs text-gray-500">{termCodes.get(d.termId)} · {fmtDate(d.decidedOn)} · by {people.get(d.decidedById ?? "")?.name}{d.deadline ? ` · deadline ${fmtDate(d.deadline)}` : ""}</div></td>
                    <td className="text-xs"><Link className="link" href={`/bodies/${d.bodyId}`}>{org.bodies.get(d.bodyId)?.name}</Link></td>
                    <td className="text-xs">{people.get(d.responsibleId ?? "")?.name ?? "—"}</td>
                    <td>{canManageBody(actor, org, d.bodyId) || d.responsibleId === actor.id ? (
                      <form action={decisionStatusAction} className="flex gap-1"><input type="hidden" name="id" value={d.id} /><select name="status" defaultValue={d.status} className="input py-1 text-xs">{["open", "in_progress", "done", "reversed"].map((x) => <option key={x}>{x}</option>)}</select><SubmitButton className="btn-ghost btn-sm">✓</SubmitButton></form>
                    ) : <StatusBadge status={d.status} />}</td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <div className="p-4"><Empty>No decisions logged.</Empty></div>}
          </Card>
        </div>
        <div className="space-y-6">
          {chairOf.length ? (
            <Card title="Open a motion">
              <ActionForm action={createMotionAction} resetOnSuccess>
                <Field label="Voting body"><select name="bodyId" className="input">{chairOf.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
                <Field label="Title"><input name="title" className="input" /></Field>
                <Field label="Description"><textarea name="description" rows={3} className="input" /></Field>
                <div className="grid grid-cols-2 gap-2"><Field label="Quorum"><input name="quorum" type="number" min={1} defaultValue={2} className="input" /></Field><Field label="Closes"><input name="closesAt" type="datetime-local" className="input" /></Field></div>
                <SubmitButton>Open voting</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
          {decisionBodies.length ? (
            <Card title="Log a decision">
              <ActionForm action={createDecisionAction} resetOnSuccess>
                <Field label="Body"><select name="bodyId" className="input">{decisionBodies.map((b) => <option key={b.id} value={b.id}>{bodyPath(org, b.id) || b.name}</option>)}</select></Field>
                <Field label="Decision"><input name="title" className="input" /></Field>
                <Field label="Details & supporting documents"><textarea name="description" rows={3} className="input" /></Field>
                <Field label="Responsible person"><select name="responsibleId" className="input"><option value="">—</option>{peopleList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
                <Field label="Deadline"><input name="deadline" type="date" className="input" /></Field>
                <SubmitButton>Log decision</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
