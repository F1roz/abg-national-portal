import { redirect } from "next/navigation";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { Card, Field, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton, type FormState } from "@/components/forms";
import { optStr, str } from "@/lib/util";

export const metadata = { title: "Share a case" };

async function create(_: FormState, form: FormData): Promise<FormState> {
  "use server";
  const { actor, org } = await requireActor();
  const kind = str(form, "kind") === "lesson" ? "lesson" : "good_case";
  if (!str(form, "title") || !str(form, "context") || !str(form, "approach") || !str(form, "outcome")) return { error: "Fill in title, context, approach and outcome." };
  const [c] = await db.insert(s.cases).values({
    kind, title: str(form, "title"), context: str(form, "context"), approach: str(form, "approach"), outcome: str(form, "outcome"),
    rootCause: optStr(form, "rootCause"), recommendations: optStr(form, "recommendations"), metrics: optStr(form, "metrics"),
    tags: str(form, "tags").split(",").map((t) => t.trim()).filter(Boolean), departmentKey: optStr(form, "dept"), termId: org.termId,
    bodyId: [...actor.memberBodyIds][0] ?? null, authorId: actor.id,
  }).returning();
  redirect(`/knowledge/${c!.id}`);
}

export default async function NewCase() {
  await requireActor();
  return (
    <>
      <PageHeader title="Share a case" subtitle="Problem → context → what you did → results → lessons. Future teams will thank you." />
      <Card className="max-w-3xl">
        <ActionForm action={create}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type"><select name="kind" className="input"><option value="good_case">🌟 Good case practice</option><option value="lesson">📘 Lesson learned</option></select></Field>
            <Field label="Department"><select name="dept" className="input"><option value="">—</option>{["OGX", "ICX", "BD", "MKT", "FNL", "MX", "IM", "OD", "EWA"].map((d) => <option key={d}>{d}</option>)}</select></Field>
          </div>
          <Field label="Title"><input name="title" className="input" placeholder="e.g. Why our university campaign failed" /></Field>
          <Field label="Problem & context"><textarea name="context" rows={3} className="input" /></Field>
          <Field label="What we did / tried"><textarea name="approach" rows={3} className="input" /></Field>
          <Field label="Results / what went wrong"><textarea name="outcome" rows={3} className="input" /></Field>
          <Field label="Root cause (lessons)"><textarea name="rootCause" rows={2} className="input" /></Field>
          <Field label="What we'd do differently / recommendations"><textarea name="recommendations" rows={2} className="input" /></Field>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Key metrics"><input name="metrics" className="input" /></Field><Field label="Tags"><input name="tags" className="input" placeholder="university, oGX" /></Field></div>
          <SubmitButton>Publish</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
