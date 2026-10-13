import { requireActor, denied } from "@/lib/session";
import { bodyPath } from "@/lib/org";
import { Card, Field, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { createAnnouncementAction } from "../actions";

export const metadata = { title: "New announcement" };

export default async function NewAnnouncement() {
  const { actor, org } = await requireActor();
  if (!actor.isLeader && !actor.isMC) denied();
  const bodies = [...org.bodies.values()].filter((b) => b.termId === org.termId && (actor.isMC || actor.ledBodyIds.has(b.id)));
  return (
    <>
      <PageHeader title="New announcement" />
      <Card className="max-w-3xl">
        <ActionForm action={createAnnouncementAction}>
          <Field label="Title *"><input name="title" required className="input" /></Field>
          <Field label="Message *"><textarea name="body" rows={6} required className="input" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Audience">
              <select name="audience" className="input" defaultValue="body">
                {actor.isMC ? <option value="national">National — all internal users</option> : null}
                <option value="body">Everyone in a body (below)</option>
                <option value="leadership">Leadership of a body (below)</option>
                {actor.isMC ? <option value="external">External — also partners & BOA</option> : null}
              </select>
            </Field>
            <Field label="Body"><select name="bodyId" className="input">{bodies.map((b) => <option key={b.id} value={b.id}>{bodyPath(org, b.id) || b.name}</option>)}</select></Field>
            <Field label="Priority"><select name="priority" className="input" defaultValue="normal"><option value="critical">🔴 Critical</option><option value="important">🟠 Important</option><option value="normal">🟡 Normal</option><option value="info">🔵 Information</option></select></Field>
            <Field label="Expires"><input name="expiresAt" type="datetime-local" className="input" /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="requireAck" /> Require acknowledgement (“I have read this”)</label>
          <SubmitButton>Publish & notify</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
