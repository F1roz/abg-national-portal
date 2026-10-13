import Link from "next/link";
import { desc, eq, sql as dsql } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { Badge, Card, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/util";

export const metadata = { title: "Term archive" };

export default async function ArchiveIndex() {
  await requireActor();
  const terms = await db.select().from(s.terms).orderBy(desc(s.terms.startsOn));
  const counts = async (table: typeof s.documents | typeof s.trackers | typeof s.kpis | typeof s.bodies, termId: string) =>
    (await db.select({ n: dsql<number>`count(*)::int` }).from(table).where(eq(table.termId, termId)))[0]!.n;
  const stats = await Promise.all(
    terms.map(async (t) => ({ id: t.id, docs: await counts(s.documents, t.id), trackers: await counts(s.trackers, t.id), kpis: await counts(s.kpis, t.id), bodies: await counts(s.bodies, t.id) })),
  );
  return (
    <>
      <PageHeader title="Term archive" subtitle="Institutional memory. Every term keeps its structure, documents, numbers, trackers, decisions and lessons — so each new MC starts from what the last one learned." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {terms.map((t) => {
          const st = stats.find((x) => x.id === t.id)!;
          return (
            <Link key={t.id} href={`/archive/${t.id}`} className="card block p-5 transition hover:shadow-md">
              <div className="flex items-center justify-between">
                <div className="text-xl font-bold">{t.code}</div>
                <Badge tone={t.status === "active" ? "green" : t.status === "closed" ? "gray" : "yellow"}>{t.status === "active" ? "Current term" : t.status === "closed" ? "Archived" : "Planning"}</Badge>
              </div>
              <div className="text-sm text-gray-500">{fmtDate(t.startsOn)} – {fmtDate(t.endsOn)}</div>
              <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs text-gray-600">
                <div><div className="text-lg font-bold text-gray-900">{st.bodies}</div>bodies</div>
                <div><div className="text-lg font-bold text-gray-900">{st.docs}</div>docs</div>
                <div><div className="text-lg font-bold text-gray-900">{st.trackers}</div>trackers</div>
                <div><div className="text-lg font-bold text-gray-900">{st.kpis}</div>KPIs</div>
              </div>
              {t.closedAt ? <div className="mt-2 text-xs text-gray-400">Closed {fmtDate(t.closedAt)}</div> : null}
            </Link>
          );
        })}
      </div>
      <Card title="How the archive works" className="mt-6">
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
          <li>When the MCP / IM closes a term, every tracker becomes a read-only snapshot and every body is marked closed. Nothing is deleted.</li>
          <li>Documents keep their original classification forever: the next MC sees last term&apos;s strategies, reports, numbers and handovers, but never HR or confidential files.</li>
          <li>Access follows lineage: the LCVP oGX of Dhaka South this term automatically sees what the previous LCVP oGX of Dhaka South left behind.</li>
          <li>Numbers are stored as data (not just PDFs), so you can compare a metric across terms on the KPI pages.</li>
        </ul>
      </Card>
    </>
  );
}
