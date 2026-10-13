import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { Card, Empty, PageHeader, PriorityBadge } from "@/components/ui";
import { SubmitButton } from "@/components/forms";
import { fmtDateTime } from "@/lib/util";

export const metadata = { title: "Notifications" };

async function markAll() {
  "use server";
  const { actor } = await requireActor();
  await db.update(s.notifications).set({ readAt: new Date() }).where(and(eq(s.notifications.userId, actor.id), isNull(s.notifications.readAt)));
  revalidatePath("/", "layout");
}

export default async function NotificationsPage() {
  const { actor } = await requireActor();
  const rows = await db.select().from(s.notifications).where(eq(s.notifications.userId, actor.id)).orderBy(desc(s.notifications.createdAt)).limit(150);
  const unread = rows.filter((r) => !r.readAt);
  const smart = unread.filter((r) => r.priority === "critical" || r.priority === "important");
  // Opening the page marks informational items as read; important ones stay until handled.
  await db.update(s.notifications).set({ readAt: new Date() }).where(and(eq(s.notifications.userId, actor.id), isNull(s.notifications.readAt), eq(s.notifications.priority, "info")));
  return (
    <>
      <PageHeader title="🔔 Notifications" subtitle={smart.length ? `${smart.length} thing${smart.length > 1 ? "s" : ""} need your attention` : "Nothing urgent."} actions={<><Link href="/notifications/settings" className="btn-secondary">Settings</Link><form action={markAll}><SubmitButton className="btn-secondary">Mark all read</SubmitButton></form></>} />
      <Card bodyClass="p-0">
        {rows.length ? (
          <ul className="divide-y divide-gray-100">
            {rows.map((n) => (
              <li key={n.id} className={`flex items-start gap-3 px-4 py-3 ${n.readAt ? "" : "bg-brand-soft/50"}`}>
                <PriorityBadge priority={n.priority} />
                <div className="min-w-0 flex-1">
                  {n.link ? <Link href={n.link} className="font-medium hover:underline">{n.title}</Link> : <span className="font-medium">{n.title}</span>}
                  {n.body ? <p className="text-sm text-gray-600">{n.body}</p> : null}
                  <div className="text-xs text-gray-400">{fmtDateTime(n.createdAt)}</div>
                </div>
              </li>
            ))}
          </ul>
        ) : <div className="p-4"><Empty>No notifications yet.</Empty></div>}
      </Card>
    </>
  );
}
