import { eq } from "drizzle-orm";
import { db, s } from "@/db";
import { getActor } from "@/lib/session";
import { canViewDocument } from "@/lib/access";
import { canViewTask } from "@/lib/tasks";
import { readStored } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { requestMeta } from "@/lib/auth";

/** Permission-checked file delivery. Files are never served from a public path. */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const ctx = await getActor();
  if (!ctx || (ctx.actor.user.mfaEnabled && !ctx.mfaVerified)) return new Response("Unauthorized", { status: 401 });
  const { actor, org } = ctx;
  let fileId: string | null = null;
  let inline = true;

  if (kind === "doc") {
    const [doc] = await db.select().from(s.documents).where(eq(s.documents.id, id));
    if (!doc || !canViewDocument(actor, org, doc)) return new Response("Not found", { status: 404 });
    fileId = doc.fileId;
    inline = !doc.allowDownload;
    await audit(actor.id, "document.downloaded", { type: "document", id }, { title: doc.title, classification: doc.classification }, (await requestMeta()).ip);
  } else if (kind === "task") {
    const [att] = await db.select().from(s.taskAttachments).where(eq(s.taskAttachments.id, id));
    if (!att) return new Response("Not found", { status: 404 });
    const [task] = await db.select().from(s.tasks).where(eq(s.tasks.id, att.taskId));
    if (!task || !canViewTask(actor, org, task)) return new Response("Not found", { status: 404 });
    fileId = att.fileId;
  } else {
    return new Response("Not found", { status: 404 });
  }
  if (!fileId) return new Response("Not found", { status: 404 });
  const [file] = await db.select().from(s.files).where(eq(s.files.id, fileId));
  if (!file) return new Response("Not found", { status: 404 });
  const data = await readStored(file.storageKey);
  const safeName = file.originalName.replace(/[^\w.\- ()]/g, "_");
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    },
  });
}
