import { eq } from "drizzle-orm";
import { db, s } from "@/db";

export type Settings = {
  /** Hours before the deadline when reminders go out */
  reminderHoursBefore: number[];
  /** Days after the deadline: [assignee nudge, notify assigner, escalate to supervisor, flag to next level] */
  escalationDays: { stillOverdue: number; notifyAssigner: number; escalate: number; flag: number };
  /** Local hour (0-23) after which "daily update missing" reminders are sent */
  dailyReminderHour: number;
  /** Missed daily updates in 7 days before the TL / next leader is informed */
  missedUpdatesNotifyLeader: number;
  missedUpdatesNotifyNextLevel: number;
  /** Days of the week without daily-update expectations (0 = Sunday … 6 = Saturday) */
  weekendDays: number[];
  /** Offer reminders: hours after sending, and hours before expiry for the final reminder */
  offerReminderHours: number[];
  offerFinalReminderHours: number;
  /** Days after start date before incomplete onboarding is flagged */
  onboardingGraceDays: number;
  /** Days before a document expires (MoUs, contracts) when the owner is warned */
  documentExpiryWarnDays: number[];
};

export const DEFAULT_SETTINGS: Settings = {
  reminderHoursBefore: [168, 72, 24, 3],
  escalationDays: { stillOverdue: 1, notifyAssigner: 2, escalate: 3, flag: 5 },
  dailyReminderHour: 21,
  missedUpdatesNotifyLeader: 3,
  missedUpdatesNotifyNextLevel: 5,
  weekendDays: [5],
  offerReminderHours: [24, 48],
  offerFinalReminderHours: 24,
  onboardingGraceDays: 14,
  documentExpiryWarnDays: [30, 15, 7],
};

export async function getSettings(): Promise<Settings> {
  const [row] = await db.select().from(s.settings).where(eq(s.settings.key, "automation"));
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) };
}

export async function saveSettings(value: Settings, userId: string) {
  await db.insert(s.settings).values({ key: "automation", value, updatedById: userId }).onConflictDoUpdate({ target: s.settings.key, set: { value, updatedById: userId, updatedAt: new Date() } });
}
