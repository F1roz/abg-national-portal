/**
 * Contribution score — deliberately not revenue-only:
 *   Performance  : tasks completed (5) + on time bonus (2)
 *   Contribution : tracker rows added (2)
 *   Consistency  : daily updates (1)
 *   Culture      : recognition received (5)
 *   Learning     : education / events attended (3)
 */
import { and, eq, gte, inArray } from "drizzle-orm";
import { db, s } from "@/db";

export type ScoreRow = { userId: string; score: number; tasks: number; onTime: number; rows: number; updates: number; recognition: number; learning: number };

export async function contributionScores(userIds: string[], since: Date): Promise<ScoreRow[]> {
  if (!userIds.length) return [];
  const sinceDate = since.toISOString().slice(0, 10);
  const [tasks, rows, updates, recog, att] = await Promise.all([
    db.select({ u: s.tasks.assigneeId, due: s.tasks.dueAt, done: s.tasks.completedAt }).from(s.tasks).where(and(inArray(s.tasks.assigneeId, userIds), eq(s.tasks.status, "completed"), gte(s.tasks.completedAt, since))),
    db.select({ u: s.trackerRows.createdById }).from(s.trackerRows).where(and(inArray(s.trackerRows.createdById, userIds), gte(s.trackerRows.createdAt, since))),
    db.select({ u: s.dailyUpdates.userId }).from(s.dailyUpdates).where(and(inArray(s.dailyUpdates.userId, userIds), gte(s.dailyUpdates.date, sinceDate))),
    db.select({ u: s.recognitions.toId }).from(s.recognitions).where(and(inArray(s.recognitions.toId, userIds), gte(s.recognitions.createdAt, since))),
    db.select({ u: s.eventAttendance.userId }).from(s.eventAttendance).where(and(inArray(s.eventAttendance.userId, userIds), gte(s.eventAttendance.at, since))),
  ]);
  const count = (list: { u: string | null }[], u: string) => list.filter((x) => x.u === u).length;
  return userIds
    .map((u) => {
      const t = tasks.filter((x) => x.u === u);
      const onTime = t.filter((x) => x.due && x.done && x.done <= x.due).length;
      const r = { userId: u, tasks: t.length, onTime, rows: count(rows, u), updates: count(updates, u), recognition: count(recog, u), learning: count(att, u) };
      return { ...r, score: r.tasks * 5 + r.onTime * 2 + r.rows * 2 + r.updates + r.recognition * 5 + r.learning * 3 };
    })
    .sort((a, b) => b.score - a.score);
}
