/**
 * File storage on local disk. Files are stored under random keys (never the original name) and are only
 * served through /api/files/[id], which checks permissions. Swap the two functions below for S3/R2 in production.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { db, s } from "@/db";
import { randomToken, sha256 } from "./util";

const ROOT = path.resolve(process.env.STORAGE_DIR ?? "./storage");
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const ALLOWED = new Set([
  "application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "text/plain", "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint", "application/zip",
]);

export async function saveUpload(file: File, uploadedById: string): Promise<string> {
  if (file.size === 0) throw new Error("Empty file");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("File is larger than 20 MB");
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED.has(mime)) throw new Error(`File type ${mime} is not allowed`);
  const buf = Buffer.from(await file.arrayBuffer());
  const now = new Date();
  const key = path.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, "0"), randomToken(18));
  await mkdir(path.join(ROOT, path.dirname(key)), { recursive: true });
  await writeFile(path.join(ROOT, key), buf);
  const [row] = await db
    .insert(s.files)
    .values({ storageKey: key, originalName: file.name.slice(0, 200), mimeType: mime, size: file.size, sha256: sha256(buf), uploadedById })
    .returning({ id: s.files.id });
  return row!.id;
}

export async function readStored(storageKey: string): Promise<Buffer> {
  const full = path.resolve(ROOT, storageKey);
  if (!full.startsWith(ROOT + path.sep)) throw new Error("Invalid storage key");
  return readFile(full);
}
