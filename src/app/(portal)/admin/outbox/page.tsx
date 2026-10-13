import { desc } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor, denied } from "@/lib/session";
import { Card, StatusBadge } from "@/components/ui";
import { fmtDateTime } from "@/lib/util";

export default async function Outbox({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { actor } = await requireActor();
  if (!(actor.isMCP || actor.system.has("system_admin") || actor.system.has("im_admin"))) denied();
  const { id } = await searchParams;
  const rows = await db.select().from(s.emailOutbox).orderBy(desc(s.emailOutbox.createdAt)).limit(100);
  const open = rows.find((r) => r.id === id);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Latest emails" bodyClass="p-0">
        <table className="table"><thead><tr><th>To</th><th>Subject</th><th>Status</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className={r.id === id ? "bg-brand-soft" : ""}><td className="text-xs">{r.to}</td><td><a className="link text-sm" href={`/admin/outbox?id=${r.id}`}>{r.subject}</a><div className="text-xs text-gray-400">{fmtDateTime(r.createdAt)}</div></td><td><StatusBadge status={r.status === "logged" ? "draft" : r.status === "sent" ? "done" : r.status === "failed" ? "rejected" : "pending"} />{r.error ? <div className="text-xs text-red-600">{r.error}</div> : null}</td></tr>)}</tbody>
        </table>
      </Card>
      <Card title={open ? open.subject : "Preview"}>
        {open ? <iframe title="Email preview" sandbox="" srcDoc={open.html} className="h-[70vh] w-full rounded border" /> : <p className="text-sm text-gray-500">Select an email. Without SMTP configured, emails are kept here as “logged”. Note: emails contain one-time links — handle with care.</p>}
      </Card>
    </div>
  );
}
