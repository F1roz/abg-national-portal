import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { bodiesOfUser, canViewReviewsOf, leadsUser } from "@/lib/access";
import { usersByIds } from "@/lib/org";
import { notify } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { Badge, Card, Empty, Field, Notice, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton, type FormState } from "@/components/forms";
import { fmtDate, optStr, str } from "@/lib/util";

export const metadata = { title: "Reviews" };

const CATEGORIES = ["Ownership", "Accountability", "Leadership", "Communication", "Teamwork", "Strategic thinking", "Execution", "Learning agility", "AIESEC values"];

async function submitReview(_: FormState, form: FormData): Promise<FormState> {
  "use server";
  const { actor, org } = await requireActor();
  const subjectId = str(form, "subjectId");
  const isSelf = subjectId === actor.id;
  const isManager = leadsUser(actor, org, subjectId);
  const isPeer = !isSelf && !isManager && bodiesOfUser(org, subjectId).some((b) => actor.memberBodyIds.has(b));
  if (!isSelf && !isManager && !isPeer) return { error: "You can review yourself, people you lead, or peers in your team." };
  const scores: Record<string, number> = {};
  for (const c of CATEGORIES) {
    const v = Number(str(form, `s_${c}`));
    if (v >= 1 && v <= 5) scores[c] = v;
  }
  const kind = isSelf ? "self" : isManager ? "manager" : "peer";
  await db.insert(s.reviews).values({ subjectId, reviewerId: actor.id, termId: org.termId, kind, scores, strengths: optStr(form, "strengths"), developmentAreas: optStr(form, "developmentAreas"), goals: optStr(form, "goals"), sharedWithSubject: isSelf || (isManager && form.get("share") === "on") });
  await audit(actor.id, "review.submitted", { type: "user", id: subjectId }, { kind });
  if (isManager && form.get("share") === "on") await notify([subjectId], { type: "system", priority: "normal", title: "New feedback was shared with you", link: `/reviews/${subjectId}` });
  revalidatePath(`/reviews/${subjectId}`);
  return { ok: true, message: "Review saved." };
}

export default async function ReviewsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, org } = await requireActor();
  const isSelf = id === actor.id;
  const canSeeAll = canViewReviewsOf(actor, org, id) && !isSelf;
  const isPeer = !isSelf && !canSeeAll && bodiesOfUser(org, id).some((b) => actor.memberBodyIds.has(b));
  if (!isSelf && !canSeeAll && !isPeer) notFound();
  const [subject] = await db.select().from(s.users).where(eq(s.users.id, id));
  if (!subject) notFound();
  const all = await db.select().from(s.reviews).where(eq(s.reviews.subjectId, id)).orderBy(desc(s.reviews.createdAt));
  // Subject sees self reviews + what managers shared. Leadership chain sees all. Peers see only what they wrote.
  const visible = all.filter((r) => (canSeeAll ? true : isSelf ? r.kind === "self" || r.sharedWithSubject : r.reviewerId === actor.id));
  const reviewers = await usersByIds(visible.map((r) => r.reviewerId));
  const averages = CATEGORIES.map((c) => {
    const v = visible.map((r) => r.scores[c]).filter((x): x is number => typeof x === "number");
    return { c, avg: v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null };
  });
  return (
    <>
      <PageHeader title={`Reviews — ${subject.name}`} subtitle="360° feedback: self, manager and peer. Private: never visible to peers or other departments." />
      {isPeer ? <Notice>You can give peer feedback. You only see what you wrote yourself.</Notice> : null}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Competency averages (visible reviews)">
            <ul className="grid gap-1 text-sm sm:grid-cols-2">{averages.map((a) => <li key={a.c} className="flex justify-between"><span>{a.c}</span><span className="font-semibold">{a.avg ?? "—"}</span></li>)}</ul>
          </Card>
          {visible.length ? visible.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone="purple">{r.kind}</Badge><strong>{reviewers.get(r.reviewerId)?.name}</strong><span className="text-gray-400">{fmtDate(r.createdAt)}</span>{r.sharedWithSubject ? <Badge tone="green">shared with {subject.name.split(" ")[0]}</Badge> : null}</div>
              <div className="mt-2 flex flex-wrap gap-1 text-xs">{Object.entries(r.scores).map(([k, v]) => <Badge key={k}>{k}: {v}</Badge>)}</div>
              {r.strengths ? <p className="mt-2 text-sm"><strong>Strengths:</strong> {r.strengths}</p> : null}
              {r.developmentAreas ? <p className="text-sm"><strong>Development areas:</strong> {r.developmentAreas}</p> : null}
              {r.goals ? <p className="text-sm"><strong>Goals:</strong> {r.goals}</p> : null}
            </Card>
          )) : <Card><Empty>No reviews yet.</Empty></Card>}
        </div>
        <Card title={isSelf ? "Write a self review" : canSeeAll ? "Write a manager review" : "Give peer feedback"}>
          <ActionForm action={submitReview} resetOnSuccess>
            <input type="hidden" name="subjectId" value={id} />
            {CATEGORIES.map((c) => (
              <label key={c} className="flex items-center justify-between text-sm">{c}<select name={`s_${c}`} className="input w-20 py-1"><option value="">—</option>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></label>
            ))}
            <Field label="Strengths"><textarea name="strengths" rows={2} className="input" /></Field>
            <Field label="Development areas"><textarea name="developmentAreas" rows={2} className="input" /></Field>
            <Field label="Goals"><textarea name="goals" rows={2} className="input" /></Field>
            {canSeeAll ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="share" /> Share with {subject.name.split(" ")[0]}</label> : null}
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
