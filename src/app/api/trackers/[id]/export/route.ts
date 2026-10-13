import { asc, eq } from "drizzle-orm";
import { db, s } from "@/db";
import { getActor } from "@/lib/session";
import { canViewBodyWork } from "@/lib/access";
import { usersByIds } from "@/lib/org";
import { audit } from "@/lib/audit";

function csvCell(v: unknown): string {
  let t = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Audited CSV export of a single tracker (bulk exports go through the two-person approval in Admin). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getActor();
  if (!ctx || (ctx.actor.user.mfaEnabled && !ctx.mfaVerified)) return new Response("Unauthorized", { status: 401 });
  const [tracker] = await db.select().from(s.trackers).where(eq(s.trackers.id, id));
  if (!tracker || !canViewBodyWork(ctx.actor, ctx.org, tracker.bodyId)) return new Response("Not found", { status: 404 });
  const rows = await db.select().from(s.trackerRows).where(eq(s.trackerRows.trackerId, id)).orderBy(asc(s.trackerRows.createdAt));
  const userCols = tracker.columns.filter((c) => c.type === "user").map((c) => c.key);
  const people = await usersByIds(rows.flatMap((r) => userCols.map((k) => r.data[k]).filter((v): v is string => typeof v === "string")));
  const lines = [tracker.columns.map((c) => csvCell(c.label)).join(",")];
  for (const r of rows) {
    lines.push(tracker.columns.map((c) => csvCell(c.type === "user" ? people.get(String(r.data[c.key]))?.name ?? "" : r.data[c.key])).join(","));
  }
  await audit(ctx.actor.id, "tracker.exported", { type: "tracker", id }, { rows: rows.length, name: tracker.name });
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${tracker.name.replace(/[^\w\- ]/g, "_")}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
