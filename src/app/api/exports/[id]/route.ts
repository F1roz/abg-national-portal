import { and, eq, isNull } from "drizzle-orm";
import { db, s } from "@/db";
import { getActor } from "@/lib/session";
import { positionLabels } from "@/lib/org";
import { withActuals } from "@/lib/kpi";
import { audit } from "@/lib/audit";

function cell(v: unknown): string {
  let t = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** One-time download of an approved bulk export (two-person rule). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getActor();
  if (!ctx || (ctx.actor.user.mfaEnabled && !ctx.mfaVerified)) return new Response("Unauthorized", { status: 401 });
  const [r] = await db.select().from(s.approvalRequests).where(eq(s.approvalRequests.id, id));
  if (!r || r.action !== "bulk_export" || r.status !== "approved" || r.requestedById !== ctx.actor.id) return new Response("Not available", { status: 404 });
  await db.update(s.approvalRequests).set({ status: "executed" }).where(eq(s.approvalRequests.id, id));
  let lines: string[];
  if (r.payload.dataset === "kpis") {
    const kpis = await withActuals(await db.select().from(s.kpis).where(and(eq(s.kpis.termId, ctx.org.termId), isNull(s.kpis.userId))));
    lines = ["Body,KPI,Target,Actual,Achievement %", ...kpis.map((k) => [ctx.org.bodies.get(k.bodyId)?.name, k.name, k.target, k.actual, k.achievement].map(cell).join(","))];
  } else {
    // Directory export: internal-visibility fields only — never restricted/private fields.
    const users = await db.select().from(s.users).where(eq(s.users.status, "active"));
    lines = ["Name,Portal email,University,Positions", ...users.filter((u) => u.userType === "internal").map((u) => [u.name, u.email, u.university, positionLabels(ctx.org, u.id).join(" | ")].map(cell).join(","))];
  }
  await audit(ctx.actor.id, "export.downloaded", { type: "approval", id }, { dataset: r.payload.dataset, rows: lines.length - 1, approvedBy: r.decidedById });
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="abg-${r.payload.dataset}.csv"`, "Cache-Control": "private, no-store" } });
}
