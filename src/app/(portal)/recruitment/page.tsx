import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor, denied } from "@/lib/session";
import { leadsBody } from "@/lib/access";
import { canManageCandidate, canManageRecruitment } from "@/lib/recruitment";
import { bodyPath } from "@/lib/org";
import { internalPeople } from "@/lib/people";
import { Card, Empty, Field, PageHeader, StatusBadge } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { addCandidateAction } from "./actions";

export const metadata = { title: "Recruitment" };

const FUNNEL: [string, string[]][] = [
  ["Selected", ["selected"]], ["Offer sent", ["offer_generated", "offer_sent"]], ["Offer viewed", ["offer_viewed"]], ["Offer accepted", ["offer_accepted", "nda_pending"]],
  ["NDA signed", ["nda_signed", "account_created"]], ["Account activated", ["account_activated"]], ["Onboarding", ["onboarding_in_progress"]], ["Active", ["onboarding_completed", "active"]],
];
const LATER: Record<string, number> = Object.fromEntries(FUNNEL.flatMap(([, st], i) => st.map((x) => [x, i])));

export default async function RecruitmentPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { actor, org } = await requireActor();
  const { status } = await searchParams;
  const admin = canManageRecruitment(actor);
  if (!admin && !actor.isLeader) denied();
  const all = (await db.select().from(s.candidates).where(eq(s.candidates.termId, org.termId)).orderBy(desc(s.candidates.createdAt))).filter((c) => canManageCandidate(actor, org, c));
  const list = status ? all.filter((c) => c.status === status) : all;
  const ids = all.filter((c) => c.userId).map((c) => c.userId!);
  const items = ids.length ? await db.select().from(s.onboardingItems).where(inArray(s.onboardingItems.userId, ids)) : [];
  const progress = (u: string | null) => { if (!u) return null; const mine = items.filter((i) => i.userId === u); return mine.length ? Math.round((mine.filter((i) => i.doneAt).length / mine.length) * 100) : null; };
  const reached = (i: number) => all.filter((c) => (LATER[c.status] ?? -1) >= i).length;
  const positions = [...org.positions.values()].filter((p) => org.bodies.get(p.bodyId)?.termId === org.termId && (admin || leadsBody(actor, org, p.bodyId)));
  const people = await internalPeople(org);
  const mark = (ok: boolean, pending: boolean) => (ok ? "✅" : pending ? "⏳" : "—");

  return (
    <>
      <PageHeader title="🎯 Recruitment & onboarding" subtitle="Applied → selected → offer → NDA → account → onboarding → active, fully tracked." />
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {FUNNEL.map(([label], i) => (<div key={label} className="card p-3 text-center"><div className="text-xl font-bold">{reached(i)}</div><div className="text-xs text-gray-500">{label}</div></div>))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={`Candidates (${list.length})`} className="lg:col-span-2" bodyClass="p-0" actions={status ? <Link href="/recruitment" className="link text-sm">clear filter</Link> : null}>
          {list.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Candidate</th><th>Position</th><th>Status</th><th>Offer</th><th>NDA</th><th>Account</th><th>Onboarding</th></tr></thead>
                <tbody>{list.map((c) => {
                  const st = LATER[c.status] ?? -1;
                  const pos = c.positionId ? org.positions.get(c.positionId) : undefined;
                  const pr = progress(c.userId);
                  return (
                    <tr key={c.id}>
                      <td><Link className="link font-medium" href={`/recruitment/${c.id}`}>{c.fullName}</Link><div className="text-xs text-gray-500">{c.email}</div></td>
                      <td className="text-xs">{pos?.title}<div className="text-gray-400">{pos ? bodyPath(org, pos.bodyId) : ""}</div></td>
                      <td><Link href={`/recruitment?status=${c.status}`}><StatusBadge status={c.status} /></Link></td>
                      <td>{mark(st >= 3, st >= 1 && st < 3)}</td><td>{mark(st >= 4, st === 3)}</td><td>{mark(st >= 5, st === 4)}</td><td>{pr === null ? "—" : `${pr}%`}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          ) : <div className="p-4"><Empty>No candidates.</Empty></div>}
        </Card>
        <Card title="Add candidate">
          <ActionForm action={addCandidateAction}>
            <Field label="Full name *"><input name="fullName" required className="input" /></Field>
            <Field label="Preferred name"><input name="preferredName" className="input" /></Field>
            <Field label="Email *"><input name="email" type="email" required className="input" /></Field>
            <Field label="Phone"><input name="phone" className="input" /></Field>
            <Field label="Position"><select name="positionId" className="input"><option value="">—</option>{positions.map((p) => <option key={p.id} value={p.id}>{p.title} · {bodyPath(org, p.bodyId)}</option>)}</select></Field>
            <Field label="Reporting manager"><select name="reportingUserId" className="input"><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.label ? ` — ${p.label}` : ""}</option>)}</select></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Start date"><input name="startDate" type="date" className="input" /></Field><Field label="Offer expires"><input name="offerExpiresOn" type="date" className="input" /></Field></div>
            <SubmitButton>Add</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
