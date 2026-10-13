"use server";
import { revalidatePath } from "next/cache";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { localDate, str } from "@/lib/util";
import type { FormState } from "@/components/forms";

export async function submitDailyAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor } = await requireActor();
  const accomplished = str(form, "accomplished");
  if (accomplished.length < 3) return { error: "Tell us what you accomplished today." };
  const metrics: Record<string, number> = {};
  for (const [k, v] of form.entries()) {
    if (k.startsWith("m_") && typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) metrics[k.slice(2)] = n;
    }
  }
  const values = {
    accomplished, workingOn: str(form, "workingOn") || null, blockers: str(form, "blockers") || null,
    supportNeeded: str(form, "supportNeeded") || null, tomorrow: str(form, "tomorrow") || null, metrics,
  };
  await db
    .insert(s.dailyUpdates)
    .values({ userId: actor.id, date: localDate(), ...values })
    .onConflictDoUpdate({ target: [s.dailyUpdates.userId, s.dailyUpdates.date], set: values });
  revalidatePath("/", "layout");
  return { ok: true, message: "Daily update saved. Thank you!" };
}
