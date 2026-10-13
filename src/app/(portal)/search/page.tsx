import Link from "next/link";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { canViewBodyWork, canViewDocument, inAudience } from "@/lib/access";
import { canViewTask } from "@/lib/tasks";
import { bodyPath, positionLabels } from "@/lib/org";
import { Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/util";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { actor, org } = await requireActor();
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  if (q.length < 2) return <><PageHeader title="Search" /><Card><Empty>Type at least two characters in the search bar.</Empty></Card></>;
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const terms = new Map((await db.select().from(s.terms)).map((t) => [t.id, t.code]));
  const [people, docs, cases, events, posts, tasks, ideas, decisions] = await Promise.all([
    db.select().from(s.users).where(and(eq(s.users.userType, "internal"), or(ilike(s.users.name, like), ilike(s.users.university, like), ilike(s.users.preferredName, like)))).limit(30),
    db.select().from(s.documents).where(or(ilike(s.documents.title, like), ilike(s.documents.description, like))).orderBy(desc(s.documents.createdAt)).limit(100),
    db.select().from(s.cases).where(or(ilike(s.cases.title, like), ilike(s.cases.context, like), ilike(s.cases.approach, like), ilike(s.cases.recommendations, like))).limit(20),
    db.select().from(s.events).where(ilike(s.events.title, like)).orderBy(desc(s.events.startsAt)).limit(30),
    db.select().from(s.posts).where(ilike(s.posts.body, like)).orderBy(desc(s.posts.createdAt)).limit(30),
    db.select().from(s.tasks).where(ilike(s.tasks.title, like)).orderBy(desc(s.tasks.createdAt)).limit(60),
    db.select().from(s.ideas).where(or(ilike(s.ideas.title, like), ilike(s.ideas.idea, like))).limit(20),
    db.select().from(s.decisions).where(ilike(s.decisions.title, like)).limit(20),
  ]);
  const needle = q.toLowerCase();
  const skillPeople = (await db.select().from(s.users).where(eq(s.users.userType, "internal"))).filter((u) => !people.some((p) => p.id === u.id) && (u.skills.some((x) => x.toLowerCase().includes(needle)) || positionLabels(org, u.id).some((l) => l.toLowerCase().includes(needle))));
  const bodies = [...org.bodies.values()].filter((b) => b.name.toLowerCase().includes(needle) || (b.departmentKey ?? "").toLowerCase() === needle).slice(0, 20);
  const trackers = (await db.select().from(s.trackers).where(eq(s.trackers.termId, org.termId))).filter((t) => (t.name.toLowerCase().includes(needle) || bodyPath(org, t.bodyId).toLowerCase().includes(needle)) && canViewBodyWork(actor, org, t.bodyId)).slice(0, 20);
  const groups: { title: string; items: { href: string; label: string; sub?: string }[] }[] = [
    { title: "People", items: [...people, ...skillPeople].slice(0, 30).map((u) => ({ href: `/people/${u.id}`, label: u.name, sub: positionLabels(org, u.id)[0] })) },
    { title: "Documents", items: docs.filter((d) => canViewDocument(actor, org, d)).slice(0, 25).map((d) => ({ href: d.fileId ? `/api/files/doc/${d.id}` : d.externalUrl ?? "/documents", label: d.title, sub: `${terms.get(d.termId)} · ${org.bodies.get(d.bodyId)?.name}` })) },
    { title: "Bodies & teams", items: bodies.map((b) => ({ href: `/bodies/${b.id}`, label: b.name, sub: `${b.type} · ${terms.get(b.termId)}` })) },
    { title: "Trackers", items: trackers.map((t) => ({ href: `/trackers/${t.id}`, label: t.name, sub: bodyPath(org, t.bodyId) })) },
    { title: "Cases & lessons", items: cases.map((c) => ({ href: `/knowledge/${c.id}`, label: c.title, sub: `${c.kind === "good_case" ? "Good case" : "Lesson"} · ${terms.get(c.termId)}` })) },
    { title: "Tasks", items: tasks.filter((t) => canViewTask(actor, org, t)).slice(0, 20).map((t) => ({ href: `/tasks/${t.id}`, label: t.title, sub: t.status })) },
    { title: "Events", items: events.filter((e) => inAudience(actor, org, e.audience, e.bodyId)).map((e) => ({ href: `/events/${e.id}`, label: e.title, sub: fmtDate(e.startsAt) })) },
    { title: "Posts", items: posts.filter((p) => inAudience(actor, org, p.audience, p.bodyId)).map((p) => ({ href: "/newsfeed", label: p.body.slice(0, 90), sub: fmtDate(p.createdAt) })) },
    { title: "Ideas", items: ideas.map((i) => ({ href: "/ideas", label: i.title, sub: i.status })) },
    { title: "Decisions", items: decisions.filter((d) => canViewBodyWork(actor, org, d.bodyId)).map((d) => ({ href: "/governance", label: d.title, sub: d.code })) },
  ].filter((g) => g.items.length);
  return (
    <>
      <PageHeader title={`Search: “${q}”`} subtitle={`${groups.reduce((a, g) => a + g.items.length, 0)} results you have access to`} />
      {groups.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((g) => (
            <Card key={g.title} title={`${g.title} (${g.items.length})`}>
              <ul className="space-y-1.5 text-sm">{g.items.map((i, k) => <li key={k}><Link className="link" href={i.href}>{i.label}</Link>{i.sub ? <span className="ml-1 text-xs text-gray-500">{i.sub}</span> : null}</li>)}</ul>
            </Card>
          ))}
        </div>
      ) : <Card><Empty>No results you can access.</Empty></Card>}
    </>
  );
}
