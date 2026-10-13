"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, s } from "@/db";
import { AUDIENCES } from "@/db/schema";
import { requireActor } from "@/lib/session";
import { canContributeToBody, leadsBody, inAudience } from "@/lib/access";
import { localDate, optStr, parseLocalDateTime, randomToken, str } from "@/lib/util";
import type { FormState } from "@/components/forms";

const KINDS = ["meeting", "education", "conference", "recruitment", "deadline", "partner", "global", "social"] as const;

export async function createEventAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor, org } = await requireActor();
  const bodyId = str(form, "bodyId");
  if (!canContributeToBody(actor, org, bodyId)) return { error: "You can create events only for bodies you belong to." };
  const audience = str(form, "audience") as (typeof AUDIENCES)[number];
  if ((audience === "national" || audience === "external") && !actor.isMC) return { error: "Only the MC can create national events." };
  const startsAt = parseLocalDateTime(str(form, "startsAt"));
  if (!str(form, "title") || !startsAt) return { error: "Title and start time are required." };
  const kind = str(form, "kind") as (typeof KINDS)[number];
  const [e] = await db
    .insert(s.events)
    .values({ title: str(form, "title"), description: optStr(form, "description"), kind: KINDS.includes(kind) ? kind : "meeting", startsAt, endsAt: parseLocalDateTime(str(form, "endsAt")), venue: optStr(form, "venue"), bodyId, audience: AUDIENCES.includes(audience) ? audience : "body", createdById: actor.id, checkinCode: randomToken(12) })
    .returning();
  redirect(`/events/${e!.id}`);
}

async function loadEventForOrganiser(id: string) {
  const { actor, org } = await requireActor();
  const [e] = await db.select().from(s.events).where(eq(s.events.id, id));
  if (!e) throw new Error("Not found");
  const organiser = e.createdById === actor.id || (e.bodyId && leadsBody(actor, org, e.bodyId)) || actor.isMCP;
  if (!organiser) throw new Error("Not allowed");
  return e;
}

export async function rotateCodeAction(form: FormData) {
  const e = await loadEventForOrganiser(str(form, "id"));
  await db.update(s.events).set({ checkinCode: randomToken(12) }).where(eq(s.events.id, e.id));
  revalidatePath(`/events/${e.id}`);
}

export async function confirmCheckinAction(form: FormData) {
  const { actor, org } = await requireActor();
  const [e] = await db.select().from(s.events).where(eq(s.events.checkinCode, str(form, "code")));
  if (!e || !inAudience(actor, org, e.audience, e.bodyId)) redirect("/calendar?checkin=invalid");
  await db.insert(s.eventAttendance).values({ eventId: e.id, userId: actor.id }).onConflictDoNothing();
  // Event attendance also counts as attendance for the day.
  const today = localDate();
  const [att] = await db.select().from(s.attendance).where(and(eq(s.attendance.userId, actor.id), eq(s.attendance.date, today)));
  if (!att) await db.insert(s.attendance).values({ userId: actor.id, date: today, checkInAt: new Date(), method: "event_qr", eventId: e.id });
  redirect(`/events/${e.id}?checked=1`);
}
