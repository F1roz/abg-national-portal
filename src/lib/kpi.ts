import { inArray, sql as dsql } from "drizzle-orm";
import { db, s } from "@/db";
import type { TrackerRollup } from "@/db/schema";

type Row = { data: Record<string, string | number | null> };

export function applyRollup(rows: Row[], r: TrackerRollup): number {
  const filtered = r.where ? rows.filter((x) => r.where!.in.includes(String(x.data[r.where!.column] ?? ""))) : rows;
  if (r.agg === "count") return filtered.length;
  return filtered.reduce((acc, x) => acc + (Number(x.data[r.column ?? ""]) || 0), 0);
}

export type KpiWithActual = typeof s.kpis.$inferSelect & { actual: number; achievement: number };

/** Actual = sum of entries (manual, task contributions, imports) + the bound tracker rollup if any. */
export async function withActuals(list: (typeof s.kpis.$inferSelect)[]): Promise<KpiWithActual[]> {
  if (!list.length) return [];
  const ids = list.map((k) => k.id);
  const sums = await db
    .select({ kpiId: s.kpiEntries.kpiId, total: dsql<string>`coalesce(sum(${s.kpiEntries.value}),0)` })
    .from(s.kpiEntries)
    .where(inArray(s.kpiEntries.kpiId, ids))
    .groupBy(s.kpiEntries.kpiId);
  const sumMap = new Map(sums.map((x) => [x.kpiId, Number(x.total)]));

  const trackerIds = [...new Set(list.filter((k) => k.source === "tracker" && k.trackerId).map((k) => k.trackerId!))];
  const trackers = trackerIds.length ? await db.select().from(s.trackers).where(inArray(s.trackers.id, trackerIds)) : [];
  const rows = trackerIds.length ? await db.select({ trackerId: s.trackerRows.trackerId, data: s.trackerRows.data }).from(s.trackerRows).where(inArray(s.trackerRows.trackerId, trackerIds)) : [];
  const rowsBy = new Map<string, Row[]>();
  for (const r of rows) rowsBy.set(r.trackerId, [...(rowsBy.get(r.trackerId) ?? []), r]);
  const trackerMap = new Map(trackers.map((t) => [t.id, t]));

  return list.map((k) => {
    let actual = sumMap.get(k.id) ?? 0;
    if (k.source === "tracker" && k.trackerId && k.rollupIndex !== null) {
      const t = trackerMap.get(k.trackerId);
      const rollup = t?.rollups[k.rollupIndex];
      if (rollup) actual += applyRollup(rowsBy.get(k.trackerId) ?? [], rollup);
    }
    return { ...k, actual, achievement: k.target ? Math.round((actual / k.target) * 100) : 0 };
  });
}

export function averageAchievement(list: { achievement: number }[]): number | null {
  if (!list.length) return null;
  return Math.round(list.reduce((a, k) => a + Math.min(k.achievement, 150), 0) / list.length);
}
