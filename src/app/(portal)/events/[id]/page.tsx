import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { eq } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { inAudience, leadsBody } from "@/lib/access";
import { usersByIds } from "@/lib/org";
import { Card, Notice, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/forms";
import { APP_URL, fmtDateTime } from "@/lib/util";
import { rotateCodeAction } from "../../calendar/actions";

export const metadata = { title: "Event" };

export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ checked?: string }> }) {
  const { id } = await params;
  const { checked } = await searchParams;
  const { actor, org } = await requireActor();
  const [e] = await db.select().from(s.events).where(eq(s.events.id, id));
  if (!e || !inAudience(actor, org, e.audience, e.bodyId)) notFound();
  const organiser = e.createdById === actor.id || (e.bodyId ? leadsBody(actor, org, e.bodyId) : false) || actor.isMCP;
  const attendees = await db.select().from(s.eventAttendance).where(eq(s.eventAttendance.eventId, id));
  const people = await usersByIds(attendees.map((a) => a.userId));
  const qr = organiser && e.checkinCode ? await QRCode.toDataURL(`${APP_URL}/checkin/${e.checkinCode}`, { width: 320, margin: 1 }) : null;
  const iAttended = attendees.some((a) => a.userId === actor.id);
  return (
    <>
      <PageHeader title={e.title} subtitle={`${fmtDateTime(e.startsAt)}${e.endsAt ? ` – ${fmtDateTime(e.endsAt)}` : ""}${e.venue ? ` · ${e.venue}` : ""} · ${org.bodies.get(e.bodyId ?? "")?.name ?? ""}`} />
      {checked || iAttended ? <Notice tone="green">✅ Your attendance is recorded.</Notice> : null}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="About" className="lg:col-span-2"><p className="whitespace-pre-wrap text-sm">{e.description || "No description."}</p></Card>
        {qr ? (
          <Card title="Attendance QR (organisers)">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="Check-in QR code" className="mx-auto" />
            <p className="mt-2 text-center text-xs text-gray-500">Participants scan this and confirm with their portal account. No location is collected.</p>
            <form action={rotateCodeAction} className="mt-2 text-center"><input type="hidden" name="id" value={id} /><SubmitButton className="btn-secondary btn-sm">Rotate code</SubmitButton></form>
          </Card>
        ) : null}
        {organiser ? (
          <Card title={`Attendees (${attendees.length})`} className="lg:col-span-3">
            <ul className="grid gap-1 text-sm sm:grid-cols-3">{attendees.map((a) => <li key={a.userId}>{people.get(a.userId)?.name} <span className="text-xs text-gray-400">{fmtDateTime(a.at)}</span></li>)}</ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
