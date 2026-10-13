import Link from "next/link";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, notInArray, sql as dsql } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { inAudience, usersInSubtree } from "@/lib/access";
import { attentionFor, reportingFor, taskHealth } from "@/lib/insights";
import { averageAchievement, withActuals } from "@/lib/kpi";
import { usersByIds } from "@/lib/org";
import { Card, Empty, PriorityBadge, Progress, Stat, StatusBadge } from "@/components/ui";
import { fmtDate, fmtDateTime, localDate, relTime } from "@/lib/util";
import { checkInAction, checkOutAction } from "../attendance/actions";
import { SubmitButton } from "@/components/forms";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const { actor, org } = await requireActor();
  const today = localDate();
  const now = new Date();
  const endOfToday = new Date(now.getTime() + 24 * 3600_000);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

  const [myTasks, completedWeek, att, daily, ann, acks, events, recog, unread, myKpis] = await Promise.all([
    db.select().from(s.tasks).where(and(eq(s.tasks.assigneeId, actor.id), eq(s.tasks.termId, org.termId), notInArray(s.tasks.status, ["completed", "rejected"]))).orderBy(asc(s.tasks.dueAt)),
    db.select({ n: dsql<number>`count(*)::int` }).from(s.tasks).where(and(eq(s.tasks.assigneeId, actor.id), eq(s.tasks.status, "completed"), gte(s.tasks.completedAt, weekAgo))),
    db.select().from(s.attendance).where(and(eq(s.attendance.userId, actor.id), eq(s.attendance.date, today))).limit(1),
    db.select().from(s.dailyUpdates).where(and(eq(s.dailyUpdates.userId, actor.id), eq(s.dailyUpdates.date, today))).limit(1),
    db.select().from(s.announcements).where(and(lte(s.announcements.startsAt, now))).orderBy(desc(s.announcements.createdAt)).limit(30),
    db.select().from(s.announcementAcks).where(eq(s.announcementAcks.userId, actor.id)),
    db.select().from(s.events).where(and(gte(s.events.startsAt, new Date(now.getTime() - 3 * 3600_000)), lte(s.events.startsAt, new Date(now.getTime() + 7 * 86_400_000)))).orderBy(asc(s.events.startsAt)),
    db.select().from(s.recognitions).where(eq(s.recognitions.toId, actor.id)).orderBy(desc(s.recognitions.createdAt)).limit(3),
    db.select().from(s.notifications).where(and(eq(s.notifications.userId, actor.id), isNull(s.notifications.readAt))).orderBy(desc(s.notifications.createdAt)).limit(5),
    db.select().from(s.kpis).where(and(eq(s.kpis.termId, org.termId), actor.memberBodyIds.size ? inArray(s.kpis.bodyId, [...actor.memberBodyIds]) : dsql`false`)),
  ]);

  const overdue = myTasks.filter((t) => t.dueAt && t.dueAt < now);
  const dueToday = myTasks.filter((t) => t.dueAt && t.dueAt >= now && t.dueAt <= endOfToday);
  const needsAck = myTasks.filter((t) => t.requireAck && !t.acknowledgedAt);
  const ackSet = new Set(acks.map((a) => a.announcementId));
  const visibleAnn = ann.filter((a) => (!a.expiresAt || a.expiresAt > now) && inAudience(actor, org, a.audience, a.bodyId));
  const annNeedAck = visibleAnn.filter((a) => a.requireAck && !ackSet.has(a.id));
  const myEvents = events.filter((e) => inAudience(actor, org, e.audience, e.bodyId));
  const eventsToday = myEvents.filter((e) => fmtDate(e.startsAt) === fmtDate(now));
  const kpis = await withActuals(myKpis.filter((k) => !k.userId || k.userId === actor.id));
  const myKpi = averageAchievement(kpis.filter((k) => k.userId === actor.id).length ? kpis.filter((k) => k.userId === actor.id) : kpis);
  const recogUsers = await usersByIds(recog.map((r) => r.fromId));

  // Leader block
  const led = [...actor.ledBodyIds];
  const teamUsers = [...new Set(led.flatMap((b) => [...usersInSubtree(org, b)]))].filter((u) => u !== actor.id);
  const teamUserIds = teamUsers.slice(0, 500);
  const [assignedByMe, teamRep, attention] = actor.isLeader
    ? await Promise.all([taskHealth({ createdById: actor.id }, org.termId), reportingFor(teamUserIds, org.termId), actor.isMCP ? Promise.resolve([]) : attentionFor(org, led, org.termId)])
    : [null, [], []];
  const teamNames = await usersByIds(teamRep.filter((r) => !r.dailyDone).map((r) => r.userId).slice(0, 20));
  const missingToday = teamRep.filter((r) => !r.dailyDone);

  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", hour: "numeric", hourCycle: "h23" }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const quick = [
    { href: "/tasks/new", label: "➕ Create task" },
    { href: "/daily", label: "📝 Daily update" },
    { href: "/trackers", label: "📋 Update tracker" },
    { href: "/recognition", label: "🏆 Recognise someone" },
    { href: "/leave", label: "🏖 Request leave" },
    { href: "/ideas", label: "💡 Submit idea" },
    { href: "/documents?upload=1", label: "📁 Upload document" },
    { href: "/knowledge/new", label: "🧠 Share a case" },
    ...(actor.isLeader || actor.isMC ? [{ href: "/announcements/new", label: "📢 Announce" }, { href: "/calendar?new=1", label: "📅 Create event" }] : []),
    ...(actor.isMC ? [{ href: "/command", label: "🧭 Command center" }] : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          {greeting}, {actor.user.preferredName ?? actor.user.name.split(" ")[0]} 👋
        </h1>
        <p className="text-sm text-gray-500">{new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now)} · What do you need to know and do today?</p>
      </div>

      {needsAck.length || annNeedAck.length ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm">
          <div className="font-semibold text-red-800">Requires your acknowledgement</div>
          <ul className="mt-1 list-disc pl-5 text-red-700">
            {needsAck.map((t) => (<li key={t.id}><Link className="underline" href={`/tasks/${t.id}`}>Task: {t.title}</Link></li>))}
            {annNeedAck.map((a) => (<li key={a.id}><Link className="underline" href={`/announcements#${a.id}`}>Announcement: {a.title}</Link></li>))}
          </ul>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Overdue" value={`🔴 ${overdue.length}`} tone={overdue.length ? "red" : undefined} href="/tasks?view=mine&filter=overdue" />
        <Stat label="Due today" value={`🟡 ${dueToday.length}`} href="/tasks" />
        <Stat label="Done this week" value={`🟢 ${completedWeek[0]?.n ?? 0}`} />
        <Stat label="My KPI" value={myKpi === null ? "—" : `${myKpi}%`} tone={myKpi === null ? undefined : myKpi >= 90 ? "green" : myKpi >= 60 ? "yellow" : "red"} href="/kpis" />
        <Stat label="Check-in" value={att[0] ? `⏰ ${fmtDateTime(att[0].checkInAt).split(", ")[1] ?? fmtDateTime(att[0].checkInAt)}` : "Not yet"} href="/attendance" />
        <Stat label="Daily update" value={daily[0] ? "✅ Done" : "Pending"} tone={daily[0] ? "green" : "yellow"} href="/daily" />
      </div>

      <div className="flex flex-wrap gap-2">
        {!att[0] ? (
          <form action={checkInAction}><SubmitButton>⏰ Check in</SubmitButton></form>
        ) : !att[0].checkOutAt ? (
          <form action={checkOutAction}><SubmitButton className="btn-secondary">Check out</SubmitButton></form>
        ) : null}
        {quick.map((q) => (
          <Link key={q.href} href={q.href} className="btn-secondary">{q.label}</Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={`My tasks (${myTasks.length})`} actions={<Link href="/tasks" className="link text-sm">All tasks</Link>} className="lg:col-span-2" bodyClass="p-0">
          {myTasks.length ? (
            <ul className="divide-y divide-gray-100">
              {myTasks.slice(0, 7).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/tasks/${t.id}`} className="block truncate font-medium hover:underline">{t.title}</Link>
                    <div className="text-xs text-gray-500">{t.dueAt ? <span className={t.dueAt < now ? "font-semibold text-red-600" : ""}>Due {relTime(t.dueAt)}</span> : "No deadline"}</div>
                  </div>
                  <div className="flex shrink-0 gap-1.5"><PriorityBadge priority={t.priority} /><StatusBadge status={t.status} /></div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4"><Empty>Nothing on your plate. 🎉</Empty></div>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Upcoming (7 days)" actions={<Link href="/calendar" className="link text-sm">Calendar</Link>}>
            {myEvents.length ? (
              <ul className="space-y-2 text-sm">
                {myEvents.slice(0, 5).map((e) => (
                  <li key={e.id}>
                    <Link href={`/events/${e.id}`} className="font-medium hover:underline">{e.title}</Link>
                    <div className="text-xs text-gray-500">{fmtDateTime(e.startsAt)}{e.venue ? ` · ${e.venue}` : ""}{eventsToday.includes(e) ? " · today" : ""}</div>
                  </li>
                ))}
              </ul>
            ) : <Empty>No events this week.</Empty>}
          </Card>
          <Card title="Notifications" actions={<Link href="/notifications" className="link text-sm">All</Link>}>
            {unread.length ? (
              <ul className="space-y-2 text-sm">
                {unread.map((n) => (<li key={n.id}><Link href={n.link ?? "/notifications"} className="hover:underline">{n.priority === "critical" ? "🔴 " : n.priority === "important" ? "🟠 " : ""}{n.title}</Link></li>))}
              </ul>
            ) : <Empty>You're all caught up.</Empty>}
          </Card>
        </div>
      </div>

      {actor.isLeader && assignedByMe ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Tasks I assigned" actions={<Link href="/tasks?view=assigned" className="link text-sm">Open</Link>}>
            <div className="mb-2 text-3xl font-bold">{assignedByMe.total ? Math.round(((assignedByMe.total - assignedByMe.overdue) / assignedByMe.total) * 100) : 100}% <span className="text-sm font-normal text-gray-500">on track</span></div>
            <div className="grid grid-cols-2 gap-1 text-sm">
              <span>🟢 {assignedByMe.completed} completed</span><span>🟡 {assignedByMe.inProgress} in progress</span>
              <span>🔴 {assignedByMe.overdue} overdue</span><span>⚠️ {assignedByMe.blocked} blocked</span>
              <span>🟣 {assignedByMe.review} awaiting review</span>
            </div>
          </Card>
          <Card title={`My team today (${teamRep.length})`} actions={<Link href="/reporting" className="link text-sm">Reporting</Link>}>
            <div className="text-sm">
              <div>✅ {teamRep.filter((r) => r.dailyDone).length} daily updates in · ⏰ {teamRep.filter((r) => r.checkedIn).length} checked in</div>
              {missingToday.length ? (
                <div className="mt-2 text-xs text-gray-600">Missing today: {missingToday.slice(0, 8).map((r) => teamNames.get(r.userId)?.name).filter(Boolean).join(", ")}{missingToday.length > 8 ? ` +${missingToday.length - 8}` : ""}</div>
              ) : null}
              <div className="mt-3"><Progress value={teamRep.filter((r) => r.dailyDone).length} max={Math.max(teamRep.length, 1)} /></div>
            </div>
          </Card>
          <Card title="⚠️ Needs attention">
            {actor.isMCP ? <p className="text-sm">Your national view lives in the <Link href="/command" className="link">Command Center</Link>.</p> : attention.length ? (
              <ul className="space-y-2 text-sm">
                {attention.slice(0, 6).map((a, i) => (
                  <li key={i}>{a.level === "red" ? "🔴" : "🟠"} {a.link ? <Link href={a.link} className="hover:underline">{a.title}</Link> : a.title}<div className="text-xs text-gray-500">{a.detail}</div></li>
                ))}
              </ul>
            ) : <Empty>Nothing needs attention. 👏</Empty>}
          </Card>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Announcements" actions={<Link href="/announcements" className="link text-sm">All</Link>} className="lg:col-span-2">
          {visibleAnn.length ? (
            <ul className="space-y-3">
              {visibleAnn.slice(0, 4).map((a) => (
                <li key={a.id} className="text-sm">
                  <div className="flex items-center gap-2"><PriorityBadge priority={a.priority} /><span className="font-semibold">{a.title}</span></div>
                  <p className="mt-0.5 line-clamp-2 text-gray-600">{a.body}</p>
                </li>
              ))}
            </ul>
          ) : <Empty>No announcements.</Empty>}
        </Card>
        <Card title="Recognition received" actions={<Link href="/recognition" className="link text-sm">Wall</Link>}>
          {recog.length ? (
            <ul className="space-y-2 text-sm">
              {recog.map((r) => (<li key={r.id}>👏 <span className="text-gray-700">“{r.message}”</span><div className="text-xs text-gray-500">— {recogUsers.get(r.fromId)?.name}{r.badge ? ` · ${r.badge}` : ""}</div></li>))}
            </ul>
          ) : <Empty>Recognition from your colleagues will appear here.</Empty>}
        </Card>
      </div>
    </div>
  );
}
