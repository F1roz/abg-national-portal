import { and, desc, eq, gte } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { Card, Empty, PageHeader, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/forms";
import { addDays, fmtDate, fmtDateTime, localDate } from "@/lib/util";
import { checkInAction, checkOutAction } from "./actions";

export const metadata = { title: "Attendance" };

export default async function AttendancePage() {
  const { actor } = await requireActor();
  const today = localDate();
  const since = addDays(today, -30);
  const rows = await db.select().from(s.attendance).where(and(eq(s.attendance.userId, actor.id), gte(s.attendance.date, since))).orderBy(desc(s.attendance.date));
  const todayRow = rows.find((r) => r.date === today);
  const weekdays = Array.from({ length: 30 }, (_, i) => addDays(today, -i)).filter((d) => ![5].includes(new Date(`${d}T00:00:00Z`).getUTCDay())); // Friday off
  const rate = Math.round((new Set(rows.map((r) => r.date)).size / Math.max(weekdays.length, 1)) * 100);
  return (
    <>
      <PageHeader title="Attendance" subtitle="Manual check-in, or scan an event QR code. The portal never tracks your location." />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Today" value={todayRow ? `In ${fmtDateTime(todayRow.checkInAt).split(", ")[1]}` : "Not checked in"} hint={todayRow?.checkOutAt ? `Out ${fmtDateTime(todayRow.checkOutAt).split(", ")[1]}` : undefined} />
        <Stat label="Last 30 days" value={`${rate}%`} hint="of working days (Fri off)" />
        <div className="card flex items-center justify-center p-4">
          {!todayRow ? (
            <form action={checkInAction}><SubmitButton>⏰ Check in now</SubmitButton></form>
          ) : !todayRow.checkOutAt ? (
            <form action={checkOutAction}><SubmitButton className="btn-secondary">Check out</SubmitButton></form>
          ) : (
            <span className="text-sm text-gray-500">Done for today ✅</span>
          )}
        </div>
      </div>
      <Card title="History" bodyClass="p-0">
        {rows.length ? (
          <table className="table">
            <thead><tr><th>Date</th><th>Check-in</th><th>Check-out</th><th>Method</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}><td>{fmtDate(r.date)}</td><td>{fmtDateTime(r.checkInAt)}</td><td>{fmtDateTime(r.checkOutAt)}</td><td>{r.method === "event_qr" ? "Event QR" : "Manual"}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <div className="p-4"><Empty>No attendance recorded yet.</Empty></div>}
      </Card>
    </>
  );
}
