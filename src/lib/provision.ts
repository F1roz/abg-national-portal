/** Creating bodies (with their tracker + KPIs), cloning a term's structure, closing a term. */
import { and, eq, inArray } from "drizzle-orm";
import { db, s } from "@/db";
import type { BodyType, JobDescription, RoleKey } from "@/db/schema";
import { templateFor, TRACKER_TEMPLATES } from "./tracker-templates";

type BodyInput = {
  termId: string;
  type: BodyType;
  name: string;
  shortName?: string;
  parentId?: string | null;
  departmentKey?: string | null;
  lineageKey?: string | null;
  description?: string | null;
  visibility?: "standard" | "confidential";
  startsOn?: string | null;
  endsOn?: string | null;
  createdById?: string | null;
  /** Override the default tracker template (e.g. "risk" for the MCP office) */
  trackerTemplate?: string | null;
  /** Set false to skip the automatic tracker */
  withTracker?: boolean;
};

export async function createBody(input: BodyInput) {
  const [body] = await db
    .insert(s.bodies)
    .values({
      termId: input.termId, type: input.type, name: input.name, shortName: input.shortName ?? null, parentId: input.parentId ?? null,
      departmentKey: input.departmentKey ?? null, lineageKey: input.lineageKey ?? null, description: input.description ?? null,
      visibility: input.visibility ?? (input.type === "governance" ? "confidential" : "standard"),
      startsOn: input.startsOn ?? null, endsOn: input.endsOn ?? null,
    })
    .returning();
  if (input.withTracker !== false) await createDefaultTracker(body!, input.createdById ?? null, input.trackerTemplate ?? null);
  return body!;
}

export async function createDefaultTracker(body: typeof s.bodies.$inferSelect, createdById: string | null, templateKey: string | null = null) {
  const tpl = templateKey ? TRACKER_TEMPLATES[templateKey] : templateFor(body.type, body.departmentKey);
  if (!tpl) return null;
  const [tracker] = await db
    .insert(s.trackers)
    .values({ bodyId: body.id, termId: body.termId, name: tpl.name, description: tpl.description, templateKey: tpl.key, columns: tpl.columns, rollups: tpl.rollups, createdById })
    .returning();
  // MC departments get no template KPIs: national numbers are the sum of the LCs (see Command Center).
  const parent = body.parentId ? (await db.select({ type: s.bodies.type }).from(s.bodies).where(eq(s.bodies.id, body.parentId)))[0] : undefined;
  if (tpl.kpis?.length && (body.type === "department" || body.type === "team") && parent?.type !== "mc") {
    // Teams get a share of the department target; departments get the full template target.
    const factor = body.type === "team" ? 0.5 : 1;
    await db.insert(s.kpis).values(
      tpl.kpis.map((k) => ({
        bodyId: body.id, termId: body.termId, name: k.name, unit: k.unit ?? "count", target: Math.round(k.target * factor),
        source: "tracker" as const, trackerId: tracker!.id, rollupIndex: k.rollupIndex, departmentKey: body.departmentKey, metricKey: k.metricKey,
      })),
    );
  }
  return tracker!;
}

export async function createPosition(p: {
  bodyId: string; title: string; roleKey: RoleKey; reportsToId?: string | null; isLeader?: boolean; multiHolder?: boolean; jd?: JobDescription; sortOrder?: number;
}) {
  const [row] = await db
    .insert(s.positions)
    .values({ bodyId: p.bodyId, title: p.title, roleKey: p.roleKey, reportsToId: p.reportsToId ?? null, isLeader: p.isLeader ?? false, multiHolder: p.multiHolder ?? false, jd: p.jd ?? {}, sortOrder: p.sortOrder ?? 100 })
    .returning();
  return row!;
}

/**
 * Copies bodies + positions (+ reporting lines, links, fresh trackers & KPIs) from one term into another.
 * Assignments are NOT copied — the new term is staffed through recruitment/onboarding or by admins.
 * OCs and projects that already ended are skipped.
 */
export async function cloneTermStructure(fromTermId: string, toTermId: string, createdById: string | null) {
  const [from] = await db.select().from(s.terms).where(eq(s.terms.id, fromTermId));
  const [to] = await db.select().from(s.terms).where(eq(s.terms.id, toTermId));
  const rename = (n: string) => (from && to ? n.split(from.code).join(to.code) : n);
  const bodies = await db.select().from(s.bodies).where(eq(s.bodies.termId, fromTermId));
  const keep = bodies.filter((b) => !(["oc", "project", "synergy"].includes(b.type) && b.status === "closed"));
  const bodyMap = new Map<string, string>();
  // Parents before children.
  const pending = [...keep];
  let guard = 0;
  while (pending.length && guard++ < 10_000) {
    const b = pending.shift()!;
    if (b.parentId && !bodyMap.has(b.parentId) && keep.some((x) => x.id === b.parentId)) {
      pending.push(b);
      continue;
    }
    const created = await createBody({
      termId: toTermId, type: b.type, name: rename(b.name), shortName: b.shortName ?? undefined,
      parentId: b.parentId ? bodyMap.get(b.parentId) ?? null : null, departmentKey: b.departmentKey, lineageKey: b.lineageKey,
      description: b.description, visibility: b.visibility, createdById,
      trackerTemplate: null,
      withTracker: true,
    });
    bodyMap.set(b.id, created.id);
  }
  const positions = await db.select().from(s.positions).where(inArray(s.positions.bodyId, keep.map((b) => b.id)));
  const posMap = new Map<string, string>();
  for (const p of positions) {
    const np = await createPosition({ bodyId: bodyMap.get(p.bodyId)!, title: p.title, roleKey: p.roleKey, isLeader: p.isLeader, multiHolder: p.multiHolder, jd: p.jd, sortOrder: p.sortOrder });
    posMap.set(p.id, np.id);
  }
  for (const p of positions) {
    if (p.reportsToId && posMap.has(p.reportsToId)) {
      await db.update(s.positions).set({ reportsToId: posMap.get(p.reportsToId)! }).where(eq(s.positions.id, posMap.get(p.id)!));
    }
  }
  const links = await db.select().from(s.bodyLinks).where(inArray(s.bodyLinks.bodyId, keep.map((b) => b.id)));
  for (const l of links) {
    if (bodyMap.has(l.bodyId) && bodyMap.has(l.linkedBodyId)) {
      await db.insert(s.bodyLinks).values({ bodyId: bodyMap.get(l.bodyId)!, linkedBodyId: bodyMap.get(l.linkedBodyId)! }).onConflictDoNothing();
    }
  }
  return { bodies: bodyMap.size, positions: posMap.size };
}

/**
 * Closing a term: trackers become read-only snapshots, bodies close, assignments end, and people with no
 * position in the next term move to alumni. Documents and numbers stay where they are — the archive is
 * simply "everything belonging to a closed term", with its original classification.
 */
export async function closeTerm(termId: string, closedById: string) {
  const now = new Date();
  await db.update(s.trackers).set({ frozen: true, frozenAt: now }).where(eq(s.trackers.termId, termId));
  await db.update(s.bodies).set({ status: "closed" }).where(eq(s.bodies.termId, termId));
  const ending = await db.select({ userId: s.assignments.userId }).from(s.assignments).where(and(eq(s.assignments.termId, termId), eq(s.assignments.active, true)));
  await db.update(s.assignments).set({ active: false }).where(eq(s.assignments.termId, termId));
  await db.update(s.terms).set({ status: "closed", closedAt: now, closedById }).where(eq(s.terms.id, termId));

  const stillActive = new Set((await db.select({ userId: s.assignments.userId }).from(s.assignments).where(eq(s.assignments.active, true))).map((r) => r.userId));
  const toAlumni = [...new Set(ending.map((e) => e.userId))].filter((u) => !stillActive.has(u));
  if (toAlumni.length) {
    await db.update(s.users).set({ status: "alumni" }).where(and(inArray(s.users.id, toAlumni), eq(s.users.status, "active")));
    await db.update(s.sessions).set({ revokedAt: now }).where(inArray(s.sessions.userId, toAlumni));
  }
  return { alumni: toAlumni.length };
}
