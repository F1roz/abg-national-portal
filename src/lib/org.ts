/** Loads the organisation snapshot (no React / Next imports so background jobs can use it too). */
import { desc, eq, inArray } from "drizzle-orm";
import { db, s } from "@/db";
import type { Org } from "./access";

export async function getActiveTermRow() {
  const [active] = await db.select().from(s.terms).where(eq(s.terms.status, "active")).limit(1);
  if (active) return active;
  const [latest] = await db.select().from(s.terms).orderBy(desc(s.terms.startsOn)).limit(1);
  return latest ?? null;
}

export async function loadOrgData(): Promise<Org> {
  const term = await getActiveTermRow();
  const [bodies, positions, assignments, links] = await Promise.all([
    db.select().from(s.bodies),
    db.select().from(s.positions),
    db.select({ userId: s.assignments.userId, positionId: s.assignments.positionId }).from(s.assignments).where(eq(s.assignments.active, true)),
    db.select().from(s.bodyLinks),
  ]);
  const org: Org = {
    termId: term?.id ?? "",
    bodies: new Map(bodies.map((b) => [b.id, b])),
    children: new Map(),
    positions: new Map(positions.map((p) => [p.id, p])),
    holders: new Map(),
    userPositions: new Map(),
    links: new Map(),
  };
  for (const b of bodies) {
    if (!b.parentId) continue;
    const list = org.children.get(b.parentId) ?? [];
    list.push(b.id);
    org.children.set(b.parentId, list);
  }
  for (const a of assignments) {
    org.holders.set(a.positionId, [...(org.holders.get(a.positionId) ?? []), a.userId]);
    org.userPositions.set(a.userId, [...(org.userPositions.get(a.userId) ?? []), a.positionId]);
  }
  for (const l of links) {
    org.links.set(l.bodyId, [...(org.links.get(l.bodyId) ?? []), l.linkedBodyId]);
    org.links.set(l.linkedBodyId, [...(org.links.get(l.linkedBodyId) ?? []), l.bodyId]);
  }
  return org;
}

export async function historicalPositionIds(userId: string): Promise<string[]> {
  const rows = await db.select({ positionId: s.assignments.positionId }).from(s.assignments).where(eq(s.assignments.userId, userId));
  return rows.map((r) => r.positionId);
}

export async function systemRolesOf(userId: string) {
  const rows = await db.select({ role: s.systemRoles.role }).from(s.systemRoles).where(eq(s.systemRoles.userId, userId));
  return rows.map((r) => r.role);
}

export async function usersByIds(ids: string[]) {
  if (!ids.length) return new Map<string, typeof s.users.$inferSelect>();
  const rows = await db.select().from(s.users).where(inArray(s.users.id, [...new Set(ids)]));
  return new Map(rows.map((u) => [u.id, u]));
}

/** "LCVP oGX · AIESEC in Dhaka South" style labels for a user's current positions. */
export function positionLabels(org: Org, userId: string): string[] {
  return (org.userPositions.get(userId) ?? [])
    .map((pid) => org.positions.get(pid))
    .filter((p) => !!p && org.bodies.get(p.bodyId)?.termId === org.termId)
    .sort((a, b) => a!.sortOrder - b!.sortOrder)
    .map((p) => {
      const body = org.bodies.get(p!.bodyId)!;
      const lc = lcOf(org, body.id);
      return lc && lc.id !== body.id ? `${p!.title} · ${lc.shortName ?? lc.name}` : `${p!.title} · ${body.shortName ?? body.name}`;
    });
}

export function lcOf(org: Org, bodyId: string) {
  let cur = org.bodies.get(bodyId);
  while (cur) {
    if (cur.type === "lc" || cur.type === "mc") return cur;
    cur = cur.parentId ? org.bodies.get(cur.parentId) : undefined;
  }
  return undefined;
}

export function bodyPath(org: Org, bodyId: string): string {
  const names: string[] = [];
  let cur = org.bodies.get(bodyId);
  while (cur && cur.type !== "entity") {
    names.unshift(cur.shortName ?? cur.name);
    cur = cur.parentId ? org.bodies.get(cur.parentId) : undefined;
  }
  return names.join(" › ");
}
