"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { canContributeToBody, canManageBody } from "@/lib/access";
import { audit } from "@/lib/audit";
import { localDate, optStr, str } from "@/lib/util";
import type { FormState } from "@/components/forms";

export async function createKpiAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor, org } = await requireActor();
  const bodyId = str(form, "bodyId");
  if (!canManageBody(actor, org, bodyId)) return { error: "Only the body's leaders can set KPIs." };
  const name = str(form, "name");
  const target = Number(str(form, "target"));
  if (!name || !Number.isFinite(target) || target <= 0) return { error: "Name and a positive target are required." };
  const body = org.bodies.get(bodyId)!;
  const trackerId = optStr(form, "trackerRollup")?.split(":")[0] ?? null;
  const rollupIndex = optStr(form, "trackerRollup")?.split(":")[1];
  await db.insert(s.kpis).values({
    bodyId, termId: body.termId, name, target, unit: str(form, "unit") || "count", userId: optStr(form, "userId"),
    source: trackerId ? "tracker" : "manual", trackerId, rollupIndex: rollupIndex !== undefined ? Number(rollupIndex) : null,
    departmentKey: body.departmentKey, metricKey: optStr(form, "metricKey"),
  });
  await audit(actor.id, "kpi.created", { type: "body", id: bodyId }, { name, target });
  revalidatePath(`/bodies/${bodyId}`);
  return { ok: true, message: "KPI created." };
}

export async function addKpiEntryAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor, org } = await requireActor();
  const [kpi] = await db.select().from(s.kpis).where(eq(s.kpis.id, str(form, "kpiId")));
  if (!kpi) return { error: "KPI not found." };
  const allowed = kpi.userId ? kpi.userId === actor.id || canManageBody(actor, org, kpi.bodyId) : canContributeToBody(actor, org, kpi.bodyId);
  if (!allowed) return { error: "You can't log progress on this KPI." };
  const value = Number(str(form, "value"));
  if (!Number.isFinite(value) || value === 0) return { error: "Enter a non-zero number." };
  await db.insert(s.kpiEntries).values({ kpiId: kpi.id, value, occurredOn: str(form, "date") || localDate(), note: optStr(form, "note"), source: "manual", createdById: actor.id });
  revalidatePath("/kpis");
  revalidatePath(`/bodies/${kpi.bodyId}`);
  return { ok: true, message: "Logged." };
}

export async function updateKpiTargetAction(form: FormData) {
  const { actor, org } = await requireActor();
  const [kpi] = await db.select().from(s.kpis).where(eq(s.kpis.id, str(form, "kpiId")));
  if (!kpi || !canManageBody(actor, org, kpi.bodyId)) return;
  const target = Number(str(form, "target"));
  if (!Number.isFinite(target) || target <= 0) return;
  await db.update(s.kpis).set({ target }).where(eq(s.kpis.id, kpi.id));
  await audit(actor.id, "kpi.target_changed", { type: "kpi", id: kpi.id }, { from: kpi.target, to: target });
  revalidatePath(`/bodies/${kpi.bodyId}`);
}
