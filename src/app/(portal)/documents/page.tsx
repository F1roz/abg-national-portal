import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, s } from "@/db";
import { DOC_CATEGORIES } from "@/db/schema";
import { requireActor } from "@/lib/session";
import { allowedClassifications, canContributeToBody, canViewDocument } from "@/lib/access";
import { bodyPath, usersByIds } from "@/lib/org";
import { Badge, Card, Empty, Field, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { fmtDate, titleCase } from "@/lib/util";
import { uploadDocumentAction } from "./actions";

export const metadata = { title: "Documents" };

type Search = { q?: string; term?: string; cat?: string; upload?: string; body?: string; dept?: string };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { actor, org } = await requireActor();
  const terms = await db.select().from(s.terms).orderBy(desc(s.terms.startsOn));
  const all = await db.select().from(s.documents).orderBy(desc(s.documents.createdAt));
  const supersededIds = new Set(all.map((d) => d.supersedesId).filter(Boolean));
  const visible = all.filter((d) => canViewDocument(actor, org, d));
  const q = (sp.q ?? "").toLowerCase();
  const list = visible.filter(
    (d) =>
      !supersededIds.has(d.id) &&
      (!sp.term || d.termId === sp.term) &&
      (!sp.cat || d.category === sp.cat) &&
      (!sp.dept || org.bodies.get(d.bodyId)?.departmentKey === sp.dept) &&
      (!q || `${d.title} ${d.description ?? ""} ${d.tags.join(" ")} ${org.bodies.get(d.bodyId)?.name}`.toLowerCase().includes(q)),
  );
  const owners = await usersByIds(list.map((d) => d.ownerId).filter((x): x is string => !!x));
  const termCode = new Map(terms.map((t) => [t.id, t.code]));
  const uploadBodies = [...org.bodies.values()].filter((b) => b.termId === org.termId && canContributeToBody(actor, org, b.id));
  const defaultBody = sp.body && uploadBodies.some((b) => b.id === sp.body) ? sp.body : uploadBodies[0]?.id;
  const classOptions = defaultBody ? allowedClassifications(actor, org, defaultBody) : ["internal", "body"];
  const depts = [...new Set([...org.bodies.values()].map((b) => b.departmentKey).filter((x): x is string => !!x))].sort();
  const now = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Documents" subtitle={`${visible.length} documents you can access across ${terms.length} terms. Every file has an owner, a classification and an audit trail.`} actions={<Link href="/documents?upload=1" className="btn-primary">📁 Upload</Link>} />
      {sp.upload ? (
        <Card title="Upload a document" className="mb-6">
          <ActionForm action={uploadDocumentAction} resetOnSuccess className="grid gap-3 md:grid-cols-2">
            <Field label="Title *"><input name="title" required className="input" /></Field>
            <Field label="Body *">
              <select name="bodyId" defaultValue={defaultBody} className="input">{uploadBodies.map((b) => <option key={b.id} value={b.id}>{bodyPath(org, b.id) || b.name}</option>)}</select>
            </Field>
            <Field label="File (max 20 MB)"><input type="file" name="file" className="block w-full text-sm" /></Field>
            <Field label="…or link (Google Drive etc.)"><input name="externalUrl" className="input" placeholder="https://" /></Field>
            <Field label="Category"><select name="category" className="input">{DOC_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</select></Field>
            <Field label="Who can see it" hint="Options depend on your role. Archived files keep this forever.">
              <select name="classification" defaultValue="body" className="input">{classOptions.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</select>
            </Field>
            <Field label="Tags (comma separated)"><input name="tags" className="input" /></Field>
            <Field label="Expires on (MoUs, contracts)"><input name="expiresOn" type="date" className="input" /></Field>
            <Field label="Replaces an earlier version of">
              <select name="supersedesId" className="input" defaultValue=""><option value="">— new document —</option>{visible.filter((d) => d.termId === org.termId && d.ownerId === actor.id).map((d) => <option key={d.id} value={d.id}>{d.title} (v{d.version})</option>)}</select>
            </Field>
            <Field label="Description"><input name="description" className="input" /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="viewOnly" /> View only (no download)</label>
            <div className="md:col-span-2"><SubmitButton>Upload</SubmitButton></div>
          </ActionForm>
        </Card>
      ) : null}
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Search title, tags, body…" className="input max-w-xs" />
        <select name="term" defaultValue={sp.term ?? ""} className="input max-w-[140px]"><option value="">All terms</option>{terms.map((t) => <option key={t.id} value={t.id}>{t.code}</option>)}</select>
        <select name="dept" defaultValue={sp.dept ?? ""} className="input max-w-[140px]"><option value="">All depts</option>{depts.map((d) => <option key={d}>{d}</option>)}</select>
        <select name="cat" defaultValue={sp.cat ?? ""} className="input max-w-[160px]"><option value="">All categories</option>{DOC_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</select>
        <button className="btn-secondary">Search</button>
      </form>
      <Card bodyClass="p-0">
        {list.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Document</th><th>Term</th><th>Body</th><th>Owner</th><th>Classification</th></tr></thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.fileId ? <a className="link font-medium" href={`/api/files/doc/${d.id}`}>{d.title}</a> : d.externalUrl ? <a className="link font-medium" href={d.externalUrl} target="_blank" rel="noreferrer noopener">{d.title} ↗</a> : d.title}
                      {d.version > 1 ? <span className="ml-1 text-xs text-gray-400">v{d.version}</span> : null}
                      <div className="text-xs text-gray-500">{titleCase(d.category)}{d.tags.length ? ` · ${d.tags.join(", ")}` : ""}{d.expiresOn ? <span className={d.expiresOn < now ? " text-red-600" : ""}> · expires {fmtDate(d.expiresOn)}</span> : null}</div>
                    </td>
                    <td>{termCode.get(d.termId)}</td>
                    <td className="text-xs"><Link className="link" href={`/bodies/${d.bodyId}`}>{bodyPath(org, d.bodyId) || org.bodies.get(d.bodyId)?.name}</Link></td>
                    <td className="text-xs">{d.ownerId ? owners.get(d.ownerId)?.name : "—"}</td>
                    <td><Badge tone={d.classification.startsWith("confidential") ? "red" : d.classification === "internal" ? "green" : d.classification === "external" ? "blue" : "yellow"}>{titleCase(d.classification)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="p-4"><Empty>No documents match.</Empty></div>}
      </Card>
    </>
  );
}
