"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, s } from "@/db";
import { CLASSIFICATIONS, DOC_CATEGORIES } from "@/db/schema";
import { requireActor } from "@/lib/session";
import { allowedClassifications, canContributeToBody, canViewDocument } from "@/lib/access";
import { saveUpload } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { optStr, str } from "@/lib/util";
import type { FormState } from "@/components/forms";

export async function uploadDocumentAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor, org } = await requireActor();
  const bodyId = str(form, "bodyId");
  if (!canContributeToBody(actor, org, bodyId)) return { error: "You can upload only into bodies you belong to or lead." };
  const title = str(form, "title");
  if (!title) return { error: "Title is required." };
  const classification = str(form, "classification") as (typeof CLASSIFICATIONS)[number];
  if (!allowedClassifications(actor, org, bodyId).includes(classification)) return { error: "You can't use that classification." };
  const category = str(form, "category") as (typeof DOC_CATEGORIES)[number];
  const file = form.get("file");
  const url = str(form, "externalUrl");
  let fileId: string | null = null;
  try {
    if (file instanceof File && file.size > 0) fileId = await saveUpload(file, actor.id);
    else if (!/^https:\/\//.test(url)) return { error: "Attach a file or paste an https:// link (e.g. Google Drive)." };
  } catch (e) {
    return { error: (e as Error).message };
  }
  // New version of an existing document?
  let version = 1;
  const supersedesId = optStr(form, "supersedesId");
  if (supersedesId) {
    const [prev] = await db.select().from(s.documents).where(eq(s.documents.id, supersedesId));
    if (!prev || !canViewDocument(actor, org, prev)) return { error: "Previous version not found." };
    version = prev.version + 1;
  }
  const [doc] = await db
    .insert(s.documents)
    .values({
      title, description: optStr(form, "description"), fileId, externalUrl: fileId ? null : url, termId: org.bodies.get(bodyId)!.termId, bodyId,
      category: DOC_CATEGORIES.includes(category) ? category : "other", classification, ownerId: actor.id, version, supersedesId,
      tags: str(form, "tags").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10), expiresOn: optStr(form, "expiresOn"), allowDownload: form.get("viewOnly") !== "on",
    })
    .returning();
  await audit(actor.id, "document.uploaded", { type: "document", id: doc!.id }, { title, classification, bodyId, version });
  revalidatePath("/documents");
  return { ok: true, message: `Uploaded “${title}”${version > 1 ? ` as version ${version}` : ""}.` };
}
