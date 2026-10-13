import { desc } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor, denied } from "@/lib/session";
import { verifyAuditChain } from "@/lib/audit";
import { usersByIds } from "@/lib/org";
import { Card, Notice } from "@/components/ui";
import { fmtDateTime } from "@/lib/util";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { actor } = await requireActor();
  if (!(actor.system.has("system_admin") || actor.system.has("im_admin") || actor.isMCP)) denied();
  const { q = "" } = await searchParams;
  const chain = await verifyAuditChain();
  const rows = (await db.select().from(s.auditLogs).orderBy(desc(s.auditLogs.seq)).limit(500)).filter((r) => !q || `${r.action} ${r.targetType} ${JSON.stringify(r.meta)}`.toLowerCase().includes(q.toLowerCase())).slice(0, 200);
  const people = await usersByIds(rows.map((r) => r.actorId).filter((x): x is string => !!x));
  return (
    <>
      {chain.ok ? <Notice tone="green">✅ Hash chain intact — {chain.checked} entries verified. Any edit or deletion of history would break the chain.</Notice> : <Notice tone="red">❌ Audit chain broken at entry #{chain.brokenAt}. Investigate database access immediately.</Notice>}
      <form className="mb-3"><input name="q" defaultValue={q} placeholder="Filter (e.g. document.downloaded, offer, export)" className="input max-w-md" /></form>
      <Card bodyClass="p-0">
        <div className="max-h-[70vh] overflow-auto">
          <table className="table">
            <thead><tr><th>#</th><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id}><td className="text-xs text-gray-400">{r.seq}</td><td className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</td><td className="text-xs">{r.actorId ? people.get(r.actorId)?.name : "system / candidate"}</td><td className="font-mono text-xs">{r.action}</td><td className="text-xs">{r.targetType}</td><td className="max-w-md truncate font-mono text-xs text-gray-500">{JSON.stringify(r.meta)}</td></tr>)}</tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
