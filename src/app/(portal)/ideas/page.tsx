import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { db, s } from "@/db";
import { IDEA_STATUSES } from "@/db/schema";
import { requireActor } from "@/lib/session";
import { usersByIds } from "@/lib/org";
import { notify } from "@/lib/notify";
import { Badge, Card, Field, PageHeader, StatusBadge } from "@/components/ui";
import { ActionForm, SubmitButton, type FormState } from "@/components/forms";
import { optStr, relTime, str } from "@/lib/util";

export const metadata = { title: "Idea board" };

async function submit(_: FormState, form: FormData): Promise<FormState> {
  "use server";
  const { actor } = await requireActor();
  if (!str(form, "title") || !str(form, "problem") || !str(form, "idea")) return { error: "Title, problem and idea are required." };
  await db.insert(s.ideas).values({ title: str(form, "title"), problem: str(form, "problem"), idea: str(form, "idea"), impact: optStr(form, "impact"), resources: optStr(form, "resources"), departmentKey: optStr(form, "dept"), authorId: actor.id });
  revalidatePath("/ideas");
  return { ok: true, message: "Idea submitted — others can now vote on it." };
}

async function vote(form: FormData) {
  "use server";
  const { actor } = await requireActor();
  const ideaId = str(form, "id");
  const removed = await db.delete(s.ideaVotes).where(and(eq(s.ideaVotes.ideaId, ideaId), eq(s.ideaVotes.userId, actor.id))).returning();
  if (!removed.length) await db.insert(s.ideaVotes).values({ ideaId, userId: actor.id }).onConflictDoNothing();
  revalidatePath("/ideas");
}

async function setStatus(form: FormData) {
  "use server";
  const { actor } = await requireActor();
  if (!actor.isMC) return;
  const status = str(form, "status") as (typeof IDEA_STATUSES)[number];
  if (!IDEA_STATUSES.includes(status)) return;
  const [idea] = await db.update(s.ideas).set({ status }).where(eq(s.ideas.id, str(form, "id"))).returning();
  if (idea) await notify([idea.authorId], { type: "system", title: `Your idea “${idea.title}” moved to ${status}`, link: "/ideas" });
  revalidatePath("/ideas");
}

export default async function IdeasPage() {
  const { actor } = await requireActor();
  const ideas = await db.select().from(s.ideas).orderBy(desc(s.ideas.createdAt));
  const votes = await db.select().from(s.ideaVotes);
  const authors = await usersByIds(ideas.map((i) => i.authorId));
  const ranked = ideas.map((i) => ({ i, n: votes.filter((v) => v.ideaId === i.id).length, mine: votes.some((v) => v.ideaId === i.id && v.userId === actor.id) })).sort((a, b) => b.n - a.n);
  return (
    <>
      <PageHeader title="💡 Idea board" subtitle="Submitted → Review → Accepted → Pilot → Implemented → Scaled. Votes show leadership where the grassroots support is." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Submit an idea">
          <ActionForm action={submit} resetOnSuccess>
            <Field label="Title"><input name="title" className="input" /></Field>
            <Field label="Problem"><textarea name="problem" rows={2} className="input" /></Field>
            <Field label="Idea"><textarea name="idea" rows={3} className="input" /></Field>
            <Field label="Expected impact"><input name="impact" className="input" /></Field>
            <Field label="Resources needed"><input name="resources" className="input" /></Field>
            <Field label="Department"><select name="dept" className="input"><option value="">—</option>{["OGX", "ICX", "BD", "MKT", "FNL", "MX", "IM", "OD", "EWA"].map((d) => <option key={d}>{d}</option>)}</select></Field>
            <SubmitButton>Submit</SubmitButton>
          </ActionForm>
        </Card>
        <div className="space-y-4 lg:col-span-2">
          {ranked.map(({ i, n, mine }) => (
            <Card key={i.id}>
              <div className="flex gap-4">
                <form action={vote} className="text-center"><input type="hidden" name="id" value={i.id} /><button className={`flex w-14 flex-col items-center rounded-lg border py-1 ${mine ? "border-brand bg-brand-soft text-brand" : "border-gray-200"}`}><span>👍</span><span className="font-bold">{n}</span></button></form>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{i.title}</h3><StatusBadge status={i.status === "submitted" ? "submitted_idea" : i.status} />{i.departmentKey ? <Badge tone="purple">{i.departmentKey}</Badge> : null}</div>
                  <p className="mt-1 text-sm"><strong>Problem:</strong> {i.problem}</p>
                  <p className="text-sm"><strong>Idea:</strong> {i.idea}</p>
                  {i.impact ? <p className="text-sm text-gray-600"><strong>Impact:</strong> {i.impact}</p> : null}
                  <div className="mt-1 text-xs text-gray-400">{authors.get(i.authorId)?.name} · {relTime(i.createdAt)}</div>
                  {actor.isMC ? (
                    <form action={setStatus} className="mt-2 flex gap-2"><input type="hidden" name="id" value={i.id} /><select name="status" defaultValue={i.status} className="input max-w-[160px]">{IDEA_STATUSES.map((st) => <option key={st}>{st}</option>)}</select><SubmitButton className="btn-secondary btn-sm">Update</SubmitButton></form>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
