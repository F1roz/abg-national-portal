"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, s } from "@/db";
import type { TrackerColumn } from "@/db/schema";
import { requireActor } from "@/lib/session";
import { canContributeToBody, canManageBody, canViewBodyWork } from "@/lib/access";
import { createDefaultTracker } from "@/lib/provision";
import { audit } from "@/lib/audit";
import { str } from "@/lib/util";
import type { FormState } from "@/components/forms";

async function loadTracker(trackerId: string) {
  const ctx = await requireActor();
  const [tracker] = await db.select().from(s.trackers).where(eq(s.trackers.id, trackerId));
  if (!tracker || !canViewBodyWork(ctx.actor, ctx.org, tracker.bodyId)) throw new Error("Tracker not found");
  return { ...ctx, tracker };
}

function parseRow(columns: TrackerColumn[], form: FormData): { data: Record<string, string | number | null>; error?: string } {
  const data: Record<string, string | number | null> = {};
  for (const c of columns) {
    const raw = str(form, `c_${c.key}`);
    if (!raw) {
      if (c.required) return { data, error: `${c.label} is required.` };
      data[c.key] = null;
      continue;
    }
    switch (c.type) {
      case "number":
      case "currency": {
        const n = Number(raw.replace(/,/g, ""));
        if (!Number.isFinite(n)) return { data, error: `${c.label} must be a number.` };
        data[c.key] = n;
        break;
      }
      case "date":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { data, error: `${c.label} must be a date.` };
        data[c.key] = raw;
        break;
      case "select":
        if (c.options && !c.options.includes(raw)) return { data, error: `${c.label}: choose one of the options.` };
        data[c.key] = raw;
        break;
      case "url":
        if (!/^https?:\/\//.test(raw)) return { data, error: `${c.label} must be a link starting with https://` };
        data[c.key] = raw.slice(0, 500);
        break;
      default:
        data[c.key] = raw.slice(0, 2000);
    }
  }
  return { data };
}

export async function addRowAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor, org, tracker } = await loadTracker(str(form, "trackerId"));
  if (tracker.frozen) return { error: "This tracker is archived (read-only)." };
  if (!canContributeToBody(actor, org, tracker.bodyId)) return { error: "Only members and leaders of this body can add rows. MC members have read access." };
  const { data, error } = parseRow(tracker.columns, form);
  if (error) return { error };
  const ownerCol = tracker.columns.find((c) => c.type === "user" && c.key === "owner");
  const owner = (ownerCol && typeof data[ownerCol.key] === "string" ? (data[ownerCol.key] as string) : null) ?? actor.id;
  await db.insert(s.trackerRows).values({ trackerId: tracker.id, data, ownerId: owner, createdById: actor.id, updatedById: actor.id });
  revalidatePath(`/trackers/${tracker.id}`);
  return { ok: true, message: "Row added." };
}

export async function updateRowAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor, org, tracker } = await loadTracker(str(form, "trackerId"));
  if (tracker.frozen) return { error: "This tracker is archived (read-only)." };
  const [row] = await db.select().from(s.trackerRows).where(eq(s.trackerRows.id, str(form, "rowId")));
  if (!row || row.trackerId !== tracker.id) return { error: "Row not found." };
  const manager = canManageBody(actor, org, tracker.bodyId);
  const own = row.ownerId === actor.id || row.createdById === actor.id;
  if (!manager && !(own && canContributeToBody(actor, org, tracker.bodyId))) return { error: "You can edit your own rows; leaders can edit all rows." };
  const { data, error } = parseRow(tracker.columns, form);
  if (error) return { error };
  await db.update(s.trackerRows).set({ data, updatedById: actor.id, updatedAt: new Date() }).where(eq(s.trackerRows.id, row.id));
  revalidatePath(`/trackers/${tracker.id}`);
  redirect(`/trackers/${tracker.id}`);
}

export async function deleteRowAction(form: FormData) {
  const { actor, org, tracker } = await loadTracker(str(form, "trackerId"));
  if (tracker.frozen) return;
  const [row] = await db.select().from(s.trackerRows).where(eq(s.trackerRows.id, str(form, "rowId")));
  if (!row || row.trackerId !== tracker.id) return;
  if (!canManageBody(actor, org, tracker.bodyId) && row.createdById !== actor.id) return;
  await db.delete(s.trackerRows).where(eq(s.trackerRows.id, row.id));
  await audit(actor.id, "tracker.row_deleted", { type: "tracker", id: tracker.id }, { rowId: row.id });
  revalidatePath(`/trackers/${tracker.id}`);
}

export async function addColumnAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor, org, tracker } = await loadTracker(str(form, "trackerId"));
  if (tracker.frozen || !canManageBody(actor, org, tracker.bodyId)) return { error: "Only the body's leaders can change columns." };
  const label = str(form, "label");
  const type = str(form, "type") as TrackerColumn["type"];
  if (!label) return { error: "Column name is required." };
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "col";
  if (tracker.columns.some((c) => c.key === key)) return { error: "A column with that name exists." };
  const options = type === "select" ? str(form, "options").split(",").map((o) => o.trim()).filter(Boolean) : undefined;
  if (type === "select" && !options?.length) return { error: "Give the options, separated by commas." };
  await db.update(s.trackers).set({ columns: [...tracker.columns, { key, label, type, options }] }).where(eq(s.trackers.id, tracker.id));
  await audit(actor.id, "tracker.column_added", { type: "tracker", id: tracker.id }, { key, type });
  revalidatePath(`/trackers/${tracker.id}`);
  return { ok: true, message: "Column added." };
}

export async function removeColumnAction(form: FormData) {
  const { actor, org, tracker } = await loadTracker(str(form, "trackerId"));
  if (tracker.frozen || !canManageBody(actor, org, tracker.bodyId)) return;
  const key = str(form, "key");
  const usedByRollup = tracker.rollups.some((r) => r.column === key || r.where?.column === key);
  if (usedByRollup) return;
  await db.update(s.trackers).set({ columns: tracker.columns.filter((c) => c.key !== key) }).where(eq(s.trackers.id, tracker.id));
  await audit(actor.id, "tracker.column_removed", { type: "tracker", id: tracker.id }, { key });
  revalidatePath(`/trackers/${tracker.id}`);
}

export async function createTrackerAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor, org } = await requireActor();
  const bodyId = str(form, "bodyId");
  if (!canManageBody(actor, org, bodyId)) return { error: "Only the body's leaders can create trackers." };
  const body = org.bodies.get(bodyId)!;
  const template = str(form, "template");
  if (template) {
    const t = await createDefaultTracker(body, actor.id, template);
    if (t && str(form, "name")) await db.update(s.trackers).set({ name: str(form, "name") }).where(eq(s.trackers.id, t.id));
    if (t) redirect(`/trackers/${t.id}`);
  }
  const name = str(form, "name");
  if (!name) return { error: "Name the tracker." };
  const [t] = await db
    .insert(s.trackers)
    .values({ bodyId, termId: body.termId, name, columns: [{ key: "item", label: "Item", type: "text", required: true }, { key: "owner", label: "Owner", type: "user" }, { key: "status", label: "Status", type: "select", options: ["Planned", "In progress", "Done", "Blocked"] }, { key: "due", label: "Due", type: "date" }], createdById: actor.id })
    .returning();
  redirect(`/trackers/${t!.id}`);
}
