import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { usersByIds } from "@/lib/org";
import { Badge, Card, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/util";

export const metadata = { title: "Case" };

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireActor();
  const [c] = await db.select().from(s.cases).where(eq(s.cases.id, id));
  if (!c) notFound();
  const [term] = await db.select().from(s.terms).where(eq(s.terms.id, c.termId));
  const author = (await usersByIds([c.authorId])).get(c.authorId);
  const good = c.kind === "good_case";
  const sections: [string, string | null][] = [
    ["Problem & context", c.context], [good ? "Solution & execution" : "What we tried", c.approach], [good ? "Results" : "What went wrong", c.outcome],
    ["Root cause", c.rootCause], [good ? "Lessons & recommendations" : "What we'd do differently", c.recommendations], ["Metrics", c.metrics],
  ];
  return (
    <>
      <PageHeader title={`${good ? "🌟" : "📘"} ${c.title}`} subtitle={<span className="flex flex-wrap gap-1"><Badge>{term?.code}</Badge>{c.departmentKey ? <Badge tone="purple">{c.departmentKey}</Badge> : null}{c.tags.map((t) => <Badge key={t} tone="blue">#{t}</Badge>)}<span className="ml-2">by {author?.name} · {fmtDate(c.createdAt)}</span></span>} />
      <div className="grid max-w-4xl gap-4">
        {sections.filter(([, v]) => v).map(([h, v]) => <Card key={h} title={h}><p className="whitespace-pre-wrap text-sm">{v}</p></Card>)}
      </div>
    </>
  );
}
