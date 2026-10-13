import Link from "next/link";
import { and, asc, gte, lte } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { canContributeToBody, inAudience } from "@/lib/access";
import { bodyPath } from "@/lib/org";
import { Badge, Card, Empty, Field, Notice, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { APP_TZ, fmtDateTime } from "@/lib/util";
import { createEventAction } from "./actions";

export const metadata = { title: "Calendar" };

const ICON: Record<string, string> = { meeting: "👥", education: "📚", conference: "🎤", recruitment: "🎯", deadline: "⏳", partner: "🤝", global: "🌍", social: "🎉" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ new?: string; kind?: string; checkin?: string }> }) {
  const { actor, org } = await requireActor();
  const sp = await searchParams;
  const from = new Date(Date.now() - 14 * 86_400_000);
  const to = new Date(Date.now() + 90 * 86_400_000);
  const events = (await db.select().from(s.events).where(and(gte(s.events.startsAt, from), lte(s.events.startsAt, to))).orderBy(asc(s.events.startsAt)))
    .filter((e) => inAudience(actor, org, e.audience, e.bodyId))
    .filter((e) => !sp.kind || e.kind === sp.kind);
  const byDay = new Map<string, typeof events>();
  const dayKey = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: APP_TZ, weekday: "long", day: "numeric", month: "long" }).format(d);
  for (const e of events) byDay.set(dayKey(e.startsAt), [...(byDay.get(dayKey(e.startsAt)) ?? []), e]);
  const bodies = [...org.bodies.values()].filter((b) => b.termId === org.termId && canContributeToBody(actor, org, b.id));
  const now = new Date();

  return (
    <>
      <PageHeader title="📅 Calendar & events" subtitle="One calendar: team, LC, national, education, OC and global events — filtered to what you're invited to." actions={<Link href="/calendar?new=1" className="btn-primary">Create event</Link>} />
      {sp.checkin === "invalid" ? <Notice tone="red">That check-in code is invalid or expired.</Notice> : null}
      {sp.new ? (
        <Card title="New event" className="mb-6">
          <ActionForm action={createEventAction} className="grid gap-3 md:grid-cols-2">
            <Field label="Title *"><input name="title" required className="input" /></Field>
            <Field label="Type"><select name="kind" className="input">{Object.keys(ICON).map((k) => <option key={k} value={k}>{ICON[k]} {k}</option>)}</select></Field>
            <Field label="Starts *"><input name="startsAt" type="datetime-local" required className="input" /></Field>
            <Field label="Ends"><input name="endsAt" type="datetime-local" className="input" /></Field>
            <Field label="Venue"><input name="venue" className="input" placeholder="Room, address or 'Online'" /></Field>
            <Field label="Organising body"><select name="bodyId" className="input">{bodies.map((b) => <option key={b.id} value={b.id}>{bodyPath(org, b.id) || b.name}</option>)}</select></Field>
            <Field label="Who's invited"><select name="audience" className="input" defaultValue="body"><option value="body">Members of the organising body</option><option value="leadership">Leadership of the body</option>{actor.isMC ? <><option value="national">National</option><option value="external">External (partners/BOA too)</option></> : null}</select></Field>
            <Field label="Description"><input name="description" className="input" /></Field>
            <div className="md:col-span-2"><SubmitButton>Create</SubmitButton></div>
          </ActionForm>
        </Card>
      ) : null}
      <div className="mb-4 flex flex-wrap gap-1.5 text-sm">
        <Link href="/calendar" className={`rounded-full px-3 py-1 ${!sp.kind ? "bg-brand text-white" : "bg-white ring-1 ring-gray-200"}`}>All</Link>
        {Object.keys(ICON).map((k) => <Link key={k} href={`/calendar?kind=${k}`} className={`rounded-full px-3 py-1 ${sp.kind === k ? "bg-brand text-white" : "bg-white ring-1 ring-gray-200"}`}>{ICON[k]} {k}</Link>)}
      </div>
      {byDay.size ? (
        <div className="space-y-4">
          {[...byDay.entries()].map(([day, list]) => (
            <Card key={day} title={day}>
              <ul className="space-y-2">
                {list.map((e) => (
                  <li key={e.id} className={`flex flex-wrap items-center justify-between gap-2 ${e.startsAt < now ? "opacity-60" : ""}`}>
                    <div><span className="mr-1">{ICON[e.kind]}</span><Link className="font-medium hover:underline" href={`/events/${e.id}`}>{e.title}</Link><div className="text-xs text-gray-500">{fmtDateTime(e.startsAt)}{e.venue ? ` · ${e.venue}` : ""} · {org.bodies.get(e.bodyId ?? "")?.name}</div></div>
                    <Badge>{e.audience}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      ) : <Card><Empty>No events in the next 90 days.</Empty></Card>}
    </>
  );
}
