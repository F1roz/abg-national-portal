import Link from "next/link";
import { revalidatePath } from "next/cache";
import { desc } from "drizzle-orm";
import { db, s } from "@/db";
import { BADGES } from "@/db/schema";
import { requireActor } from "@/lib/session";
import { internalPeople } from "@/lib/people";
import { usersByIds } from "@/lib/org";
import { notify } from "@/lib/notify";
import { Card, Field, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton, type FormState } from "@/components/forms";
import { relTime, str } from "@/lib/util";

export const metadata = { title: "Recognition" };

async function give(_: FormState, form: FormData): Promise<FormState> {
  "use server";
  const { actor } = await requireActor();
  const to = str(form, "toId");
  const message = str(form, "message");
  if (!to || to === actor.id) return { error: "Choose a colleague (not yourself)." };
  if (message.length < 5) return { error: "Say what they did — specific recognition means more." };
  const badge = (BADGES as readonly string[]).includes(str(form, "badge")) ? str(form, "badge") : null;
  await db.insert(s.recognitions).values({ fromId: actor.id, toId: to, message: message.slice(0, 1000), badge });
  await notify([to], { type: "recognition", priority: "normal", title: `👏 ${actor.user.name} recognised you`, body: message.slice(0, 200), link: `/people/${to}` });
  revalidatePath("/recognition");
  return { ok: true, message: "Recognition sent! It now appears on their profile." };
}

export default async function RecognitionPage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const { actor, org } = await requireActor();
  const { to } = await searchParams;
  const people = (await internalPeople(org)).filter((p) => p.id !== actor.id);
  const wall = await db.select().from(s.recognitions).orderBy(desc(s.recognitions.createdAt)).limit(60);
  const names = await usersByIds(wall.flatMap((r) => [r.fromId, r.toId]));
  return (
    <>
      <PageHeader title="⭐ Recognition" subtitle="Anyone can recognise anyone. It appears on their profile and counts towards culture in the leaderboard." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Recognise someone">
          <ActionForm action={give} resetOnSuccess>
            <Field label="Who"><select name="toId" defaultValue={to} className="input"><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.label ? ` — ${p.label}` : ""}</option>)}</select></Field>
            <Field label="What did they do?"><textarea name="message" rows={4} className="input" placeholder="Shakib helped me close this partnership. Thank you!" /></Field>
            <Field label="Badge (optional)"><select name="badge" className="input"><option value="">—</option>{BADGES.map((b) => <option key={b}>{b}</option>)}</select></Field>
            <SubmitButton>👏 Send recognition</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Recognition wall" className="lg:col-span-2">
          <ul className="space-y-4">
            {wall.map((r) => (
              <li key={r.id} className="text-sm">
                <div><Link className="font-semibold hover:underline" href={`/people/${r.fromId}`}>{names.get(r.fromId)?.name}</Link> → <Link className="font-semibold hover:underline" href={`/people/${r.toId}`}>{names.get(r.toId)?.name}</Link>{r.badge ? <span className="ml-2 rounded-full bg-amber-50 px-2 text-xs text-amber-700">🏅 {r.badge}</span> : null}</div>
                <p className="text-gray-700">“{r.message}”</p>
                <div className="text-xs text-gray-400">{relTime(r.createdAt)}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
