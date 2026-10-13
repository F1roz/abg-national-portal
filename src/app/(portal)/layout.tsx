import Link from "next/link";
import { and, count, eq, isNull } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor, getActiveTerm } from "@/lib/session";
import { positionLabels } from "@/lib/org";
import { Avatar } from "@/components/ui";
import { NavLink } from "@/components/nav-link";
import type { Actor } from "@/lib/access";

type Item = { href: string; label: string; icon: string; show?: (a: Actor) => boolean };
type Group = { title?: string; items: Item[] };

const isAdmin = (a: Actor) => a.isMCP || a.system.has("system_admin") || a.system.has("im_admin");
const isRecruiter = (a: Actor) => a.isMCP || a.system.has("recruitment_admin") || a.system.has("mx_admin") || a.isLeader;

const NAV: Group[] = [
  { items: [{ href: "/dashboard", label: "Dashboard", icon: "🏠" }, { href: "/command", label: "Command Center", icon: "🧭", show: (a) => a.isMC }] },
  {
    title: "My work",
    items: [
      { href: "/tasks", label: "Tasks", icon: "✅" },
      { href: "/daily", label: "Daily Update", icon: "📝" },
      { href: "/attendance", label: "Attendance", icon: "⏰" },
      { href: "/kpis", label: "KPIs", icon: "📊" },
      { href: "/trackers", label: "Trackers", icon: "📋" },
      { href: "/reporting", label: "Team Reporting", icon: "📈", show: (a) => a.isLeader || a.isMC },
      { href: "/leaderboard", label: "Leaderboard", icon: "🏆" },
    ],
  },
  {
    title: "Communication",
    items: [
      { href: "/newsfeed", label: "Newsfeed", icon: "📰" },
      { href: "/announcements", label: "Announcements", icon: "📢" },
      { href: "/calendar", label: "Calendar & Events", icon: "📅" },
    ],
  },
  {
    title: "Knowledge",
    items: [
      { href: "/documents", label: "Documents", icon: "📁" },
      { href: "/archive", label: "Term Archive", icon: "🗄️" },
      { href: "/knowledge", label: "Cases & Lessons", icon: "🧠" },
      { href: "/ideas", label: "Idea Board", icon: "💡" },
    ],
  },
  {
    title: "Organisation",
    items: [
      { href: "/org", label: "Structure", icon: "🏢" },
      { href: "/directory", label: "Directory", icon: "👥" },
      { href: "/recognition", label: "Recognition", icon: "⭐" },
      { href: "/leave", label: "Leave", icon: "🏖" },
      { href: "/governance", label: "Governance", icon: "⚖️" },
      { href: "/handover", label: "Handover", icon: "🤝" },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/recruitment", label: "Recruitment", icon: "🎯", show: isRecruiter },
      { href: "/admin", label: "Admin", icon: "⚙️", show: isAdmin },
    ],
  },
];

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { actor, org } = await requireActor();
  const term = await getActiveTerm();
  const [{ n: unread }] = await db.select({ n: count() }).from(s.notifications).where(and(eq(s.notifications.userId, actor.id), isNull(s.notifications.readAt)));
  const labels = positionLabels(org, actor.id);

  const nav = (
    <nav className="space-y-5">
      {NAV.map((g, i) => {
        const items = g.items.filter((it) => !it.show || it.show(actor));
        if (!items.length) return null;
        return (
          <div key={i}>
            {g.title ? <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-blue-200/80">{g.title}</div> : null}
            <ul className="space-y-0.5">
              {items.map((it) => (
                <li key={it.href}>
                  <NavLink href={it.href}>
                    <span aria-hidden>{it.icon}</span> {it.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-64 shrink-0 flex-col bg-[#0b3a6e] text-white lg:flex">
        <Link href="/dashboard" className="flex items-center gap-2 px-5 py-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="h-9 w-9" />
          <div>
            <div className="text-sm font-bold leading-tight">AIESEC in Bangladesh</div>
            <div className="text-xs text-blue-200">National Portal · {term?.code}</div>
          </div>
        </Link>
        <div className="flex-1 overflow-y-auto px-3 pb-6">{nav}</div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-gray-200 bg-white/95 px-4 py-2.5 backdrop-blur">
          <details className="relative lg:hidden">
            <summary className="btn-ghost list-none cursor-pointer" aria-label="Menu">☰</summary>
            <div className="absolute left-0 top-10 z-30 max-h-[80vh] w-64 overflow-y-auto rounded-xl bg-[#0b3a6e] p-3 text-white shadow-xl">{nav}</div>
          </details>
          <form action="/search" className="flex-1">
            <input name="q" placeholder="🔍 Search AIESEC Bangladesh…" className="input max-w-xl" aria-label="Search" />
          </form>
          <Link href="/notifications" className="btn-ghost relative" aria-label="Notifications">
            🔔
            {unread > 0 ? <span className="absolute -right-0.5 -top-0.5 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{unread > 99 ? "99+" : unread}</span> : null}
          </Link>
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1 hover:bg-gray-100">
              <Avatar name={actor.user.name} src={actor.user.photoUrl} size={30} />
              <span className="hidden text-left sm:block">
                <span className="block text-sm font-semibold leading-tight">{actor.user.preferredName ?? actor.user.name}</span>
                <span className="block max-w-[220px] truncate text-xs text-gray-500">{labels[0] ?? "No active position"}</span>
              </span>
            </summary>
            <div className="absolute right-0 top-12 z-30 w-60 rounded-xl border border-gray-200 bg-white p-2 text-sm shadow-lg">
              {labels.length > 1 ? <div className="border-b border-gray-100 px-2 pb-2 text-xs text-gray-500">{labels.join(" · ")}</div> : null}
              <Link className="block rounded px-2 py-1.5 hover:bg-gray-50" href={`/people/${actor.id}`}>My profile & journey</Link>
              <Link className="block rounded px-2 py-1.5 hover:bg-gray-50" href="/profile">Edit profile & privacy</Link>
              <Link className="block rounded px-2 py-1.5 hover:bg-gray-50" href="/my-position">My position (JD)</Link>
              <Link className="block rounded px-2 py-1.5 hover:bg-gray-50" href="/onboarding">Onboarding</Link>
              <Link className="block rounded px-2 py-1.5 hover:bg-gray-50" href="/security">Security & sessions</Link>
              <Link className="block rounded px-2 py-1.5 hover:bg-gray-50" href="/notifications/settings">Notification settings</Link>
              <form action="/logout" method="post">
                <button className="w-full rounded px-2 py-1.5 text-left text-red-600 hover:bg-red-50">Sign out</button>
              </form>
            </div>
          </details>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
