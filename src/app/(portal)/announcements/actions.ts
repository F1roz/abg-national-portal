"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { db, s } from "@/db";
import { AUDIENCES } from "@/db/schema";
import { requireActor } from "@/lib/session";
import { canPublishTo, inAudience, buildActor } from "@/lib/access";
import { notify } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { optStr, parseLocalDateTime, str } from "@/lib/util";
import type { FormState } from "@/components/forms";

export async function createAnnouncementAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor, org } = await requireActor();
  const audience = str(form, "audience") as (typeof AUDIENCES)[number];
  const bodyId = optStr(form, "bodyId");
  if (!AUDIENCES.includes(audience)) return { error: "Choose an audience." };
  if (!canPublishTo(actor, org, audience, bodyId)) return { error: "You can announce only to bodies you lead (MC can announce nationally)." };
  const title = str(form, "title");
  const body = str(form, "body");
  if (!title || !body) return { error: "Title and message are required." };
  const priority = (["critical", "important", "normal", "info"].includes(str(form, "priority")) ? str(form, "priority") : "normal") as "critical" | "important" | "normal" | "info";
  const [a] = await db
    .insert(s.announcements)
    .values({ title, body, authorId: actor.id, audience, bodyId: audience === "national" || audience === "external" ? null : bodyId, priority, requireAck: form.get("requireAck") === "on", expiresAt: parseLocalDateTime(str(form, "expiresAt")) })
    .returning();
  // Fan out notifications to the audience.
  const users = await db.select().from(s.users).where(and(eq(s.users.status, "active"), ne(s.users.id, actor.id)));
  const recipients = users.filter((u) => inAudience(buildActor(org, u, []), org, audience, a!.bodyId)).map((u) => u.id);
  await notify(recipients, { type: "announcement", priority, title: `📢 ${title}`, body: body.slice(0, 200), link: `/announcements#${a!.id}`, dedupeKey: `ann:${a!.id}` });
  await audit(actor.id, "announcement.created", { type: "announcement", id: a!.id }, { audience, recipients: recipients.length });
  redirect("/announcements");
}

export async function ackAnnouncementAction(form: FormData) {
  const { actor } = await requireActor();
  await db.insert(s.announcementAcks).values({ announcementId: str(form, "id"), userId: actor.id }).onConflictDoNothing();
  revalidatePath("/announcements");
  revalidatePath("/dashboard");
}
