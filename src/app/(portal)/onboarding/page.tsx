import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull } from "drizzle-orm";
import { checkOnboardingComplete } from "@/lib/onboarding";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { Card, Empty, Notice, PageHeader, Progress } from "@/components/ui";
import { SubmitButton } from "@/components/forms";
import { str } from "@/lib/util";

export const metadata = { title: "Onboarding" };

/** Items without a task can be ticked by the member (reading the JD, meeting the TL…). */
async function tick(form: FormData) {
  "use server";
  const { actor } = await requireActor();
  await db.update(s.onboardingItems).set({ doneAt: new Date() }).where(and(eq(s.onboardingItems.id, str(form, "id")), eq(s.onboardingItems.userId, actor.id), isNull(s.onboardingItems.taskId)));
  await checkOnboardingComplete(actor.id);
  revalidatePath("/onboarding");
}

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { actor } = await requireActor();
  const { welcome } = await searchParams;
  const items = await db.select().from(s.onboardingItems).where(eq(s.onboardingItems.userId, actor.id)).orderBy(asc(s.onboardingItems.sortOrder));
  const done = items.filter((i) => i.doneAt).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 100;
  return (
    <>
      <PageHeader title="Your onboarding" subtitle={items.length ? `${done}/${items.length} completed — ${pct}%` : undefined} />
      {welcome ? <Notice tone="green">🎉 Welcome to AIESEC in Bangladesh! Your onboarding journey starts here.</Notice> : null}
      {items.length ? (
        <Card className="max-w-2xl">
          <div className="mb-4"><Progress value={pct} tone="brand" /></div>
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{i.doneAt ? "✅" : "🔴"} {i.label}{i.required ? "" : <span className="text-xs text-gray-400"> (optional)</span>}</span>
                {i.doneAt ? null : i.taskId ? <Link className="link text-xs" href={`/tasks/${i.taskId}`}>Open task</Link> : <form action={tick}><input type="hidden" name="id" value={i.id} /><SubmitButton className="btn-ghost btn-sm">Mark done</SubmitButton></form>}
              </li>
            ))}
          </ul>
          {pct === 100 ? <div className="mt-4 rounded-lg bg-green-50 p-4 text-center text-green-800">🎉 <strong>AIESEC Bangladesh Onboarding Completed</strong></div> : null}
        </Card>
      ) : <Card><Empty>No onboarding checklist — you joined before the portal or were added directly.</Empty></Card>}
    </>
  );
}
