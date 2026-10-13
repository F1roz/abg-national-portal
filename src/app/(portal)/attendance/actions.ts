"use server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { localDate } from "@/lib/util";

export async function checkInAction() {
  const { actor } = await requireActor();
  const today = localDate();
  const [existing] = await db.select().from(s.attendance).where(and(eq(s.attendance.userId, actor.id), eq(s.attendance.date, today))).limit(1);
  if (!existing) await db.insert(s.attendance).values({ userId: actor.id, date: today, checkInAt: new Date(), method: "manual" });
  revalidatePath("/", "layout");
}

export async function checkOutAction() {
  const { actor } = await requireActor();
  await db
    .update(s.attendance)
    .set({ checkOutAt: new Date() })
    .where(and(eq(s.attendance.userId, actor.id), eq(s.attendance.date, localDate()), isNull(s.attendance.checkOutAt)));
  revalidatePath("/", "layout");
}
