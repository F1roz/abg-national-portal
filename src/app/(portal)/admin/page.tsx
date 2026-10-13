import Link from "next/link";
import { count, eq } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor, denied } from "@/lib/session";
import { verifyAuditChain } from "@/lib/audit";
import { Card, Stat } from "@/components/ui";

export const metadata = { title: "Admin" };

export default async function AdminHome() {
  const { actor, org } = await requireActor();
  if (!(actor.isMCP || actor.system.has("system_admin") || actor.system.has("im_admin"))) denied();
  const [[users], [pending], [queued], chain, [lastRun]] = await Promise.all([
    db.select({ n: count() }).from(s.users),
    db.select({ n: count() }).from(s.approvalRequests).where(eq(s.approvalRequests.status, "pending")),
    db.select({ n: count() }).from(s.emailOutbox).where(eq(s.emailOutbox.status, "queued")),
    verifyAuditChain(),
    db.select().from(s.jobRuns).orderBy(s.jobRuns.startedAt).limit(1),
  ]);
  const bodies = [...org.bodies.values()].filter((b) => b.termId === org.termId).length;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Users" value={users!.n} href="/admin/users" />
        <Stat label="Bodies (this term)" value={bodies} href="/admin/structure" />
        <Stat label="Pending approvals" value={pending!.n} tone={pending!.n ? "yellow" : undefined} href="/admin/roles" />
        <Stat label="Emails queued" value={queued!.n} href="/admin/outbox" />
        <Stat label="Audit chain" value={chain.ok ? "✅ intact" : `❌ broken at #${chain.brokenAt}`} tone={chain.ok ? "green" : "red"} hint={`${chain.checked} entries verified`} href="/admin/audit" />
      </div>
      <Card title="Operations checklist">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Schedule <code>POST /api/cron</code> every 15 minutes with <code>Authorization: Bearer $CRON_SECRET</code> (reminders, escalations, offers, weekly summaries, email delivery). {lastRun ? null : <strong className="text-red-600">No automation run recorded yet.</strong>} <Link className="link" href="/admin/automation">Automation →</Link></li>
          <li>Configure SMTP in the environment; until then emails are kept in the <Link className="link" href="/admin/outbox">outbox</Link>.</li>
          <li>Back up PostgreSQL daily (and the storage directory) to a separate location — see the README&apos;s operations section.</li>
          <li>Keep at least two people with <em>system_admin</em> so the two-person rule can work.</li>
        </ul>
      </Card>
    </div>
  );
}
