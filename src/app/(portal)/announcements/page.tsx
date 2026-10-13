import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { buildActor, inAudience } from "@/lib/access";
import { usersByIds } from "@/lib/org";
import { Badge, Card, Empty, PageHeader, PriorityBadge } from "@/components/ui";
import { SubmitButton } from "@/components/forms";
import { fmtDateTime } from "@/lib/util";
import { ackAnnouncementAction } from "./actions";

export const metadata = { title: "Announcements" };

export default async function AnnouncementsPage() {
  const { actor, org } = await requireActor();
  const now = new Date();
  const all = await db.select().from(s.announcements).orderBy(desc(s.announcements.createdAt)).limit(200);
  const visible = all.filter((a) => a.startsAt <= now && inAudience(actor, org, a.audience, a.bodyId));
  const acks = visible.length ? await db.select().from(s.announcementAcks).where(inArray(s.announcementAcks.announcementId, visible.map((a) => a.id))) : [];
  const authors = await usersByIds(visible.map((a) => a.authorId));
  // Acknowledgement stats for authors
  const mine = visible.filter((a) => a.authorId === actor.id && a.requireAck);
  const activeUsers = mine.length ? await db.select().from(s.users).where(eq(s.users.status, "active")) : [];
  const audienceSize = (a: (typeof visible)[number]) => activeUsers.filter((u) => u.id !== a.authorId && inAudience(buildActor(org, u, []), org, a.audience, a.bodyId)).length;

  return (
    <>
      <PageHeader title="📢 Announcements" subtitle="Official communication, separate from the newsfeed. Some require your acknowledgement." actions={actor.isLeader || actor.isMC ? <Link href="/announcements/new" className="btn-primary">New announcement</Link> : null} />
      <div className="space-y-4">
        {visible.length ? visible.map((a) => {
          const acked = acks.some((x) => x.announcementId === a.id && x.userId === actor.id);
          const expired = a.expiresAt && a.expiresAt < now;
          return (
            <Card key={a.id} className={expired ? "opacity-60" : a.priority === "critical" ? "border-red-300" : ""}>
              <div id={a.id} className="flex flex-wrap items-center gap-2">
                <PriorityBadge priority={a.priority} />
                <h2 className="text-lg font-semibold">{a.title}</h2>
                <Badge>{a.audience === "national" ? "National" : a.audience === "body" ? org.bodies.get(a.bodyId!)?.name ?? "Body" : a.audience === "leadership" ? `Leadership${a.bodyId ? ` · ${org.bodies.get(a.bodyId)?.name}` : ""}` : "External"}</Badge>
                {expired ? <Badge>Expired</Badge> : null}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{a.body}</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                <span>{authors.get(a.authorId)?.name} · {fmtDateTime(a.createdAt)}{a.expiresAt ? ` · until ${fmtDateTime(a.expiresAt)}` : ""}</span>
                {a.requireAck ? (acked ? <span className="text-green-700">✅ You acknowledged this</span> : a.authorId !== actor.id ? (
                  <form action={ackAnnouncementAction}><input type="hidden" name="id" value={a.id} /><SubmitButton className="btn-danger btn-sm">I have read this</SubmitButton></form>
                ) : null) : null}
                {a.requireAck && a.authorId === actor.id ? <span className="font-semibold">Acknowledged by {acks.filter((x) => x.announcementId === a.id).length} / {audienceSize(a)}</span> : null}
              </div>
            </Card>
          );
        }) : <Card><Empty>No announcements.</Empty></Card>}
      </div>
    </>
  );
}
