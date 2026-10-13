import { desc } from "drizzle-orm";
import { db, s } from "@/db";
import { TEMPLATE_KINDS } from "@/db/schema";
import { requireActor } from "@/lib/session";
import { TEMPLATE_VARIABLES } from "@/lib/templates";
import { Card, Field, Tabs } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { fmtDateTime, titleCase } from "@/lib/util";
import { saveTemplateAction } from "../actions";

export default async function TemplatesAdmin({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  await requireActor();
  const { kind = "offer_letter" } = await searchParams;
  const versions = (await db.select().from(s.templates).orderBy(desc(s.templates.version))).filter((t) => t.kind === kind);
  const current = versions.find((v) => v.active) ?? versions[0];
  return (
    <>
      <Tabs active={kind} tabs={TEMPLATE_KINDS.map((k) => ({ key: k, label: titleCase(k), href: `/admin/templates?kind=${k}` }))} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={`Edit ${titleCase(kind)} (saves as a new version)`} className="lg:col-span-2">
          <ActionForm action={saveTemplateAction}>
            <input type="hidden" name="kind" value={kind} />
            <Field label="Name"><input name="name" defaultValue={current?.name} className="input" /></Field>
            {kind.startsWith("email") ? <Field label="Subject"><input name="subject" defaultValue={current?.subject ?? ""} className="input" /></Field> : null}
            <Field label="Body" hint="Formatting: # heading, ## subheading, - bullet, **bold**, blank line = new paragraph. HTML is not allowed (it is escaped)."><textarea name="body" rows={18} defaultValue={current?.body} className="input font-mono text-xs" /></Field>
            <SubmitButton>Save new version</SubmitButton>
          </ActionForm>
        </Card>
        <div className="space-y-6">
          <Card title="Variables"><div className="flex flex-wrap gap-1">{TEMPLATE_VARIABLES.map((v) => <code key={v} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{`{{${v}}}`}</code>)}</div></Card>
          <Card title="Version history">
            <ul className="space-y-1 text-sm">{versions.map((v) => <li key={v.id}>v{v.version} {v.active ? <strong className="text-green-700">active</strong> : null} <span className="text-xs text-gray-400">{fmtDateTime(v.createdAt)}</span></li>)}</ul>
            <p className="mt-2 text-xs text-gray-500">Sent offers and signed NDAs keep the exact version (and content hash) they used.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
