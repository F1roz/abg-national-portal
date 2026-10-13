import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { leadsBody } from "@/lib/access";
import { canManageCandidate, canManageRecruitment, missingForOffer } from "@/lib/recruitment";
import { bodyPath, usersByIds } from "@/lib/org";
import { internalPeople } from "@/lib/people";
import { Badge, Card, Field, Notice, PageHeader, Progress, StatusBadge } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { fmtDate, fmtDateTime, titleCase } from "@/lib/util";
import { moveCandidateAction, sendOfferAction, updateCandidateAction } from "../actions";

export const metadata = { title: "Candidate" };

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, org } = await requireActor();
  const [c] = await db.select().from(s.candidates).where(eq(s.candidates.id, id));
  if (!c || !canManageCandidate(actor, org, c)) notFound();
  const [events, offers, ndas, items] = await Promise.all([
    db.select().from(s.candidateEvents).where(eq(s.candidateEvents.candidateId, id)).orderBy(asc(s.candidateEvents.createdAt)),
    db.select().from(s.offers).where(eq(s.offers.candidateId, id)).orderBy(desc(s.offers.createdAt)),
    db.select().from(s.ndaSignatures).where(eq(s.ndaSignatures.candidateId, id)),
    c.userId ? db.select().from(s.onboardingItems).where(eq(s.onboardingItems.userId, c.userId)).orderBy(asc(s.onboardingItems.sortOrder)) : Promise.resolve([]),
  ]);
  const actors = await usersByIds(events.map((e) => e.actorId).filter((x): x is string => !!x));
  const people = await internalPeople(org);
  const admin = canManageRecruitment(actor);
  const positions = [...org.positions.values()].filter((p) => org.bodies.get(p.bodyId)?.termId === org.termId && (admin || leadsBody(actor, org, p.bodyId)));
  const missing = missingForOffer(c);
  const offerable = ["selected", "offer_generated", "offer_sent", "offer_viewed", "offer_expired"].includes(c.status);
  const done = items.filter((i) => i.doneAt).length;

  return (
    <>
      <PageHeader title={c.fullName} subtitle={<span className="flex items-center gap-2"><StatusBadge status={c.status} /> {c.email}</span>} actions={<Link href="/recruitment" className="btn-secondary">← Pipeline</Link>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Move through the pipeline">
            <div className="flex flex-wrap gap-2">
              {(["shortlisted", "assessed", "interviewed", "selected", "rejected", "withdrawn"] as const).map((st) => (
                <form key={st} action={moveCandidateAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="status" value={st} /><SubmitButton className={st === "selected" ? "btn-primary btn-sm" : st === "rejected" || st === "withdrawn" ? "btn-ghost btn-sm text-red-600" : "btn-secondary btn-sm"} confirm={st === "rejected" ? "Reject this candidate?" : undefined}>{titleCase(st)}</SubmitButton></form>
              ))}
            </div>
          </Card>
          <Card title="Offer letter">
            {offerable ? (
              <>
                {missing.length ? <Notice tone="yellow">Before generating the offer, fill in: {missing.join(", ")}.</Notice> : null}
                <ActionForm action={sendOfferAction}>
                  <input type="hidden" name="id" value={id} />
                  <p className="text-sm text-gray-600">Generates a versioned offer from the active template, emails a secure one-person link (“VIEW & ACCEPT OFFER LETTER”) and starts reminders. Any earlier open offer is revoked.</p>
                  <SubmitButton>{offers.length ? "Re-generate & resend offer" : "Generate & send offer"}</SubmitButton>
                </ActionForm>
              </>
            ) : <p className="text-sm text-gray-500">Mark the candidate as <strong>Selected</strong> to generate an offer.</p>}
            {offers.length ? (
              <table className="table mt-4">
                <thead><tr><th>Offer</th><th>Status</th><th>Sent</th><th>Viewed</th><th>Decided</th></tr></thead>
                <tbody>{offers.map((o) => <tr key={o.id}><td className="font-mono text-xs">{o.code}<div className="text-gray-400">sha256 {o.contentSha256.slice(0, 12)}…</div></td><td><StatusBadge status={o.status} /></td><td className="text-xs">{fmtDateTime(o.sentAt)}</td><td className="text-xs">{fmtDateTime(o.viewedAt)}</td><td className="text-xs">{fmtDateTime(o.decidedAt)}{o.declineReason ? <div>“{o.declineReason}”</div> : null}</td></tr>)}</tbody>
              </table>
            ) : null}
          </Card>
          {ndas.length ? <Card title="NDA">{ndas.map((n) => <p key={n.id} className="text-sm">✅ Signed as “{n.signedName}” on {fmtDateTime(n.signedAt)} · doc sha256 {n.contentSha256.slice(0, 16)}…</p>)}</Card> : null}
          {items.length ? (
            <Card title={`Onboarding ${done}/${items.length}`}>
              <Progress value={done} max={items.length} tone="brand" />
              <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">{items.map((i) => <li key={i.id}>{i.doneAt ? "✅" : "🔴"} {i.label}</li>)}</ul>
              {c.userId ? <Link className="link mt-2 block text-sm" href={`/people/${c.userId}`}>Open portal profile</Link> : null}
            </Card>
          ) : null}
          <Card title="Timeline">
            <ol className="space-y-2 text-sm">{events.map((e) => <li key={e.id}><span className="text-xs text-gray-400">{fmtDateTime(e.createdAt)}</span> <Badge>{titleCase(e.status)}</Badge> {e.note} {e.actorId ? <span className="text-xs text-gray-500">— {actors.get(e.actorId)?.name}</span> : <span className="text-xs text-gray-400">— candidate/system</span>}</li>)}</ol>
          </Card>
        </div>
        <Card title="Candidate details">
          <ActionForm action={updateCandidateAction}>
            <input type="hidden" name="id" value={id} />
            <Field label="Full name"><input name="fullName" defaultValue={c.fullName} className="input" /></Field>
            <Field label="Preferred name"><input name="preferredName" defaultValue={c.preferredName ?? ""} className="input" /></Field>
            <Field label="Phone"><input name="phone" defaultValue={c.phone ?? ""} className="input" /></Field>
            <Field label="Position"><select name="positionId" defaultValue={c.positionId ?? ""} className="input"><option value="">—</option>{positions.map((p) => <option key={p.id} value={p.id}>{p.title} · {bodyPath(org, p.bodyId)}</option>)}</select></Field>
            <Field label="Reporting manager"><select name="reportingUserId" defaultValue={c.reportingUserId ?? ""} className="input"><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Start date"><input name="startDate" type="date" defaultValue={c.startDate ?? ""} className="input" /></Field>
            <Field label="Offer expires"><input name="offerExpiresOn" type="date" defaultValue={c.offerExpiresOn ?? ""} className="input" /></Field>
            <Field label="Notes"><textarea name="notes" rows={3} defaultValue={c.notes ?? ""} className="input" /></Field>
            <SubmitButton className="btn-secondary">Save</SubmitButton>
          </ActionForm>
          {c.selectedAt ? <p className="mt-2 text-xs text-gray-400">Selected {fmtDate(c.selectedAt)}</p> : null}
        </Card>
      </div>
    </>
  );
}
