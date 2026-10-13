import { eq } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { Card, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/forms";
import { fmtDateTime } from "@/lib/util";
import { confirmCheckinAction } from "../../calendar/actions";

export const metadata = { title: "Check in" };

export default async function CheckinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  await requireActor();
  const [e] = await db.select().from(s.events).where(eq(s.events.checkinCode, code));
  if (!e) return <Notice tone="red">This check-in code is invalid or has been rotated. Ask the organiser for the current QR.</Notice>;
  return (
    <Card className="mx-auto max-w-md text-center">
      <div className="text-4xl">📍</div>
      <h1 className="mt-2 text-xl font-bold">{e.title}</h1>
      <p className="text-sm text-gray-500">{fmtDateTime(e.startsAt)}{e.venue ? ` · ${e.venue}` : ""}</p>
      <form action={confirmCheckinAction} className="mt-4"><input type="hidden" name="code" value={code} /><SubmitButton>Confirm my attendance</SubmitButton></form>
    </Card>
  );
}
