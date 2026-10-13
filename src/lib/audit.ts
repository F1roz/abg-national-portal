import { asc, desc, sql as dsql } from "drizzle-orm";
import { db, s } from "@/db";
import { sha256 } from "./util";

const GENESIS = "0".repeat(64);

/** Key-sorted JSON so the hash survives Postgres jsonb re-ordering keys. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

function rowHash(prevHash: string, seq: number, actorId: string | null, action: string, targetType: string | null, targetId: string | null, meta: unknown, createdAt: string): string {
  return sha256(canonical([prevHash, seq, actorId, action, targetType, targetId, meta, createdAt]));
}

/**
 * Append an entry to the tamper-evident audit log.
 * Never pass private message bodies, passwords or tokens in `meta`.
 */
export async function audit(
  actorId: string | null,
  action: string,
  target?: { type: string; id: string } | null,
  meta: Record<string, unknown> = {},
  ip?: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Serialise writers so the hash chain stays linear.
    await tx.execute(dsql`select pg_advisory_xact_lock(424242)`);
    const [last] = await tx.select({ seq: s.auditLogs.seq, hash: s.auditLogs.hash }).from(s.auditLogs).orderBy(desc(s.auditLogs.seq)).limit(1);
    const seq = (last?.seq ?? 0) + 1;
    const prevHash = last?.hash ?? GENESIS;
    const createdAt = new Date();
    const hash = rowHash(prevHash, seq, actorId, action, target?.type ?? null, target?.id ?? null, meta, createdAt.toISOString());
    await tx.insert(s.auditLogs).values({
      seq, actorId, action, targetType: target?.type ?? null, targetId: target?.id ?? null, meta, ip: ip ?? null, prevHash, hash, createdAt,
    });
  });
}

/** Re-computes the whole chain. Returns the first broken sequence number, or null if intact. */
export async function verifyAuditChain(): Promise<{ ok: boolean; checked: number; brokenAt: number | null }> {
  const rows = await db.select().from(s.auditLogs).orderBy(asc(s.auditLogs.seq));
  let prev = GENESIS;
  for (const r of rows) {
    const expected = rowHash(prev, r.seq, r.actorId, r.action, r.targetType, r.targetId, r.meta, r.createdAt.toISOString());
    if (r.prevHash !== prev || r.hash !== expected) return { ok: false, checked: rows.length, brokenAt: r.seq };
    prev = r.hash;
  }
  return { ok: true, checked: rows.length, brokenAt: null };
}
