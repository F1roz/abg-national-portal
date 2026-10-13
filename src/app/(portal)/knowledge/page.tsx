import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { canViewDocument } from "@/lib/access";
import { usersByIds } from "@/lib/org";
import { Badge, Card, Empty, PageHeader, Tabs } from "@/components/ui";
import { titleCase } from "@/lib/util";

export const metadata = { title: "Cases & lessons" };

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string }> }) {
  const { actor, org } = await requireActor();
  const { q = "", kind = "all" } = await searchParams;
  const terms = new Map((await db.select().from(s.terms)).map((t) => [t.id, t.code]));
  const all = await db.select().from(s.cases).orderBy(desc(s.cases.createdAt));
  const needle = q.toLowerCase();
  const list = all.filter((c) => (kind === "all" || c.kind === kind) && (!needle || `${c.title} ${c.context} ${c.approach} ${c.outcome} ${c.recommendations ?? ""} ${c.tags.join(" ")} ${c.departmentKey ?? ""}`.toLowerCase().includes(needle)));
  const authors = await usersByIds(list.map((c) => c.authorId));
  // "How do I…": related SOPs / playbooks / templates from the documents hub
  const docs = needle ? (await db.select().from(s.documents)).filter((d) => ["sop", "playbook", "template", "policy"].includes(d.category) && canViewDocument(actor, org, d) && `${d.title} ${d.tags.join(" ")} ${d.description ?? ""}`.toLowerCase().split(/\W+/).some((w) => w.length > 2 && needle.includes(w))).slice(0, 8) : [];
  return (
    <>
      <PageHeader title="🧠 Cases & lessons learned" subtitle="Institutional intelligence: what worked (good cases) and what we'd do differently (lessons learned — not a shame wall)." actions={<Link href="/knowledge/new" className="btn-primary">Share a case</Link>} />
      <form className="mb-4"><input name="q" defaultValue={q} placeholder="How do I… run a university campaign? increase approvals? recruit?" className="input max-w-2xl" /><input type="hidden" name="kind" value={kind} /></form>
      <Tabs active={kind} tabs={[{ key: "all", label: "All", href: `/knowledge?q=${encodeURIComponent(q)}` }, { key: "good_case", label: "🌟 Good cases", href: `/knowledge?kind=good_case&q=${encodeURIComponent(q)}` }, { key: "lesson", label: "📘 Lessons learned", href: `/knowledge?kind=lesson&q=${encodeURIComponent(q)}` }]} />
      {docs.length ? (
        <Card title="Related SOPs, playbooks & templates" className="mb-4">
          <ul className="space-y-1 text-sm">{docs.map((d) => <li key={d.id}>📘 {d.fileId ? <a className="link" href={`/api/files/doc/${d.id}`}>{d.title}</a> : d.title} <span className="text-xs text-gray-400">{terms.get(d.termId)} · {titleCase(d.category)}</span></li>)}</ul>
        </Card>
      ) : null}
      {list.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((c) => (
            <Link key={c.id} href={`/knowledge/${c.id}`} className="card block p-4 hover:shadow-md">
              <div className="flex flex-wrap items-center gap-2"><span>{c.kind === "good_case" ? "🌟" : "📘"}</span><span className="font-semibold">{c.title}</span></div>
              <p className="mt-1 line-clamp-2 text-sm text-gray-600">{c.context}</p>
              <div className="mt-2 flex flex-wrap gap-1"><Badge>{terms.get(c.termId)}</Badge>{c.departmentKey ? <Badge tone="purple">{c.departmentKey}</Badge> : null}{c.tags.map((t) => <Badge key={t} tone="blue">#{t}</Badge>)}</div>
              <div className="mt-1 text-xs text-gray-400">by {authors.get(c.authorId)?.name}</div>
            </Link>
          ))}
        </div>
      ) : <Card><Empty>Nothing found. Be the first to share a case on this topic.</Empty></Card>}
    </>
  );
}
