import { desc, eq } from "drizzle-orm";
import { db, s } from "@/db";
import type { CandidateStatus } from "@/db/schema";
import { audit } from "./audit";
import { notify } from "./notify";

export async function setCandidateStatus(candidateId: string, status: CandidateStatus, actorId: string | null, note?: string) {
  await db.update(s.candidates).set({ status, ...(status === "selected" ? { selectedAt: new Date() } : {}) }).where(eq(s.candidates.id, candidateId));
  await db.insert(s.candidateEvents).values({ candidateId, status, note: note ?? null, actorId });
}

/** Marks onboarding complete once every required item is done. Idempotent. */
export async function checkOnboardingComplete(userId: string) {
  const items = await db.select().from(s.onboardingItems).where(eq(s.onboardingItems.userId, userId));
  if (!items.length || items.some((i) => i.required && !i.doneAt)) return false;
  const [c] = await db.select().from(s.candidates).where(eq(s.candidates.userId, userId)).orderBy(desc(s.candidates.createdAt)).limit(1);
  if (!c || c.status === "active" || c.status === "onboarding_completed") return false;
  await setCandidateStatus(c.id, "onboarding_completed", null);
  await setCandidateStatus(c.id, "active", null);
  const [u] = await db.select().from(s.users).where(eq(s.users.id, userId));
  await notify([userId], { type: "onboarding", priority: "important", title: "🎉 AIESEC Bangladesh onboarding completed!", link: "/onboarding" });
  if (c.reportingUserId) await notify([c.reportingUserId], { type: "onboarding", title: `${u?.name} completed onboarding`, link: `/people/${userId}` });
  await audit(null, "onboarding.completed", { type: "user", id: userId });
  return true;
}
