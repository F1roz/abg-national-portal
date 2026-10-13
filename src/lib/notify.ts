import { and, eq, inArray } from "drizzle-orm";
import { db, s } from "@/db";
import { emailLayout, queueEmail } from "./email";
import { APP_URL, escapeHtml } from "./util";

export type NotifyPriority = "critical" | "important" | "normal" | "info";

/** Notification types and whether they go to email by default (portal is always on). */
export const NOTIFICATION_TYPES: Record<string, { label: string; emailDefault: boolean }> = {
  task_assigned: { label: "New task assigned", emailDefault: true },
  task_reminder: { label: "Task reminders", emailDefault: true },
  task_overdue: { label: "Task overdue", emailDefault: true },
  task_update: { label: "Task status changes (tasks I assigned)", emailDefault: false },
  task_comment: { label: "Task comments", emailDefault: false },
  task_blocked: { label: "Task marked blocked", emailDefault: true },
  escalation: { label: "Escalations", emailDefault: true },
  daily_update: { label: "Daily update reminders", emailDefault: false },
  announcement: { label: "Announcements", emailDefault: false },
  leave: { label: "Leave requests & decisions", emailDefault: true },
  recognition: { label: "Recognition received", emailDefault: false },
  onboarding: { label: "Onboarding", emailDefault: true },
  security: { label: "Security alerts", emailDefault: true },
  governance: { label: "Governance votes & decisions", emailDefault: true },
  system: { label: "System", emailDefault: false },
};

export type NotifyInput = {
  type: keyof typeof NOTIFICATION_TYPES | string;
  title: string;
  body?: string;
  link?: string;
  priority?: NotifyPriority;
  /** Same key twice = only delivered once (used by reminders and escalations). Suffixed with the user id. */
  dedupeKey?: string;
  /** Force email regardless of preferences (critical security / escalation). */
  forceEmail?: boolean;
};

export async function notify(userIds: string[], n: NotifyInput): Promise<number> {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (!unique.length) return 0;
  const inserted = await db
    .insert(s.notifications)
    .values(
      unique.map((userId) => ({
        userId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null, priority: n.priority ?? "normal",
        dedupeKey: n.dedupeKey ? `${n.dedupeKey}:${userId}` : null,
      })),
    )
    .onConflictDoNothing()
    .returning({ userId: s.notifications.userId });
  if (!inserted.length) return 0;

  const recipients = inserted.map((r) => r.userId);
  const [users, prefs] = await Promise.all([
    db.select({ id: s.users.id, email: s.users.email, name: s.users.name, preferredName: s.users.preferredName, status: s.users.status }).from(s.users).where(inArray(s.users.id, recipients)),
    db.select().from(s.notificationPrefs).where(and(inArray(s.notificationPrefs.userId, recipients), eq(s.notificationPrefs.type, n.type))),
  ]);
  const prefMap = new Map(prefs.map((p) => [p.userId, p.email]));
  const emailDefault = NOTIFICATION_TYPES[n.type]?.emailDefault ?? false;
  for (const u of users) {
    if (u.status !== "active" && u.status !== "pending_first_login") continue;
    const wantsEmail = n.forceEmail || n.priority === "critical" || (prefMap.get(u.id) ?? emailDefault);
    if (!wantsEmail) continue;
    const content = `<p>Hi ${escapeHtml(u.preferredName ?? u.name.split(" ")[0]!)},</p><p><strong>${escapeHtml(n.title)}</strong></p>${n.body ? `<p>${escapeHtml(n.body)}</p>` : ""}`;
    await queueEmail(u.email, n.title, emailLayout({ title: n.title, contentHtml: content, cta: n.link ? { label: "Open in portal", url: `${APP_URL}${n.link}` } : undefined }));
  }
  return inserted.length;
}
