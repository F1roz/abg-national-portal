/**
 * Access engine: RBAC (role keys, system roles) + ABAC (body tree, term, classification, lineage).
 *
 * Core rules
 *  • Members see the work (trackers, KPIs, documents) of the bodies they sit in.
 *  • Leaders see and manage everything in the subtree of the body they lead
 *    (TL → team, LCVP → department, LCP → LC, OCP → OC, MCP → entity).
 *  • The MC team can read every "standard" body's work across the entity, current and archived.
 *  • "confidential" bodies (governance boards by default) are visible only to their own members
 *    and the governance admin — independence from the MC is deliberate.
 *  • Archived terms: access follows lineage, so the LCVP oGX of 26.27 sees what LCVP oGX 25.26 left behind.
 *  • External accounts (partners, BOA) only ever see "external" material.
 *
 * Everything here is pure (Org + Actor in, boolean out) so it is unit-testable.
 */
import type { Classification, RoleKey, SystemRole } from "@/db/schema";
import type { s } from "@/db";

export type Body = typeof s.bodies.$inferSelect;
export type Position = typeof s.positions.$inferSelect;
export type User = typeof s.users.$inferSelect;

export type Org = {
  termId: string;
  bodies: Map<string, Body>;
  children: Map<string, string[]>;
  positions: Map<string, Position>;
  /** positionId → user ids holding it in an active assignment */
  holders: Map<string, string[]>;
  /** userId → active position ids */
  userPositions: Map<string, string[]>;
  /** bodyId → linked body ids (both directions) */
  links: Map<string, string[]>;
};

export type Actor = {
  user: User;
  id: string;
  termId: string;
  positions: { position: Position; body: Body }[];
  roleKeys: Set<RoleKey>;
  system: Set<SystemRole>;
  isMCP: boolean;
  isMC: boolean;
  isLeader: boolean;
  isGovernance: boolean;
  isExternal: boolean;
  memberBodyIds: Set<string>;
  ledBodyIds: Set<string>;
  ledLineages: Set<string>;
  memberLineages: Set<string>;
  /** Bodies the user held positions in during earlier terms */
  historicalBodyIds: Set<string>;
  departmentKeys: Set<string>;
};

// ───────────── tree helpers ─────────────

export function ancestorsOf(org: Org, bodyId: string): string[] {
  const out: string[] = [];
  let cur = org.bodies.get(bodyId)?.parentId ?? null;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = org.bodies.get(cur)?.parentId ?? null;
  }
  return out;
}

export function subtreeOf(org: Org, bodyId: string): Set<string> {
  const out = new Set<string>([bodyId]);
  const stack = [bodyId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const c of org.children.get(id) ?? []) {
      if (!out.has(c)) {
        out.add(c);
        stack.push(c);
      }
    }
  }
  return out;
}

export function rootOf(org: Org, termId: string): Body | undefined {
  for (const b of org.bodies.values()) if (b.termId === termId && !b.parentId) return b;
  return undefined;
}

/**
 * True if the body is the MC or an MC department/team. Temporary bodies hanging under the MC
 * (OCs, projects, synergy teams) do NOT make their members part of the MC.
 */
export function isWithinMC(org: Org, bodyId: string): boolean {
  for (const id of [bodyId, ...ancestorsOf(org, bodyId)]) {
    const t = org.bodies.get(id)?.type;
    if (t === "mc") return true;
    if (t === "oc" || t === "project" || t === "synergy" || t === "lc" || t === "entity") return false;
  }
  return false;
}

export function holdersOfBody(org: Org, bodyId: string, leadersOnly = false): string[] {
  const out = new Set<string>();
  for (const p of org.positions.values()) {
    if (p.bodyId !== bodyId || (leadersOnly && !p.isLeader)) continue;
    for (const u of org.holders.get(p.id) ?? []) out.add(u);
  }
  return [...out];
}

/** Every active user in a body subtree. */
export function usersInSubtree(org: Org, bodyId: string): Set<string> {
  const bodies = subtreeOf(org, bodyId);
  const out = new Set<string>();
  for (const p of org.positions.values()) {
    if (!bodies.has(p.bodyId)) continue;
    for (const u of org.holders.get(p.id) ?? []) out.add(u);
  }
  return out;
}

// ───────────── actor construction ─────────────

export function buildActor(
  org: Org,
  user: User,
  systemRoles: SystemRole[],
  historicalPositionIds: string[] = [],
): Actor {
  const positions = (org.userPositions.get(user.id) ?? [])
    .map((pid) => org.positions.get(pid))
    .filter((p): p is Position => !!p)
    .map((position) => ({ position, body: org.bodies.get(position.bodyId)! }))
    .filter((x) => x.body && x.body.termId === org.termId);

  const roleKeys = new Set(positions.map((p) => p.position.roleKey));
  const isMCP = roleKeys.has("mcp");
  const memberBodyIds = new Set(positions.map((p) => p.body.id));
  const ledBodyIds = new Set(positions.filter((p) => p.position.isLeader).map((p) => p.body.id));
  if (isMCP) {
    const root = rootOf(org, org.termId);
    if (root) ledBodyIds.add(root.id);
  }
  const lineage = (ids: Iterable<string>) => {
    const out = new Set<string>();
    for (const id of ids) {
      const k = org.bodies.get(id)?.lineageKey;
      if (k) out.add(k);
    }
    return out;
  };
  const historicalBodyIds = new Set(
    historicalPositionIds.map((pid) => org.positions.get(pid)?.bodyId).filter((x): x is string => !!x),
  );
  const departmentKeys = new Set<string>();
  for (const p of positions) {
    for (const id of [p.body.id, ...ancestorsOf(org, p.body.id)]) {
      const k = org.bodies.get(id)?.departmentKey;
      if (k) departmentKeys.add(k);
    }
  }

  return {
    user,
    id: user.id,
    termId: org.termId,
    positions,
    roleKeys,
    system: new Set(systemRoles),
    isMCP,
    isMC: positions.some((p) => isWithinMC(org, p.body.id)),
    isLeader: ledBodyIds.size > 0,
    isGovernance: positions.some((p) => p.body.type === "governance"),
    isExternal: user.userType === "partner" || user.userType === "boa",
    memberBodyIds,
    ledBodyIds,
    ledLineages: lineage(ledBodyIds),
    memberLineages: lineage(memberBodyIds),
    historicalBodyIds,
    departmentKeys,
  };
}

// ───────────── body-level rules ─────────────

export function leadsBody(actor: Actor, org: Org, bodyId: string): boolean {
  if (actor.ledBodyIds.has(bodyId)) return true;
  return ancestorsOf(org, bodyId).some((a) => actor.ledBodyIds.has(a));
}

/** Can the actor read the work of this body: trackers, KPIs, body documents, body task board. */
export function canViewBodyWork(actor: Actor, org: Org, bodyId: string): boolean {
  const body = org.bodies.get(bodyId);
  if (!body || actor.isExternal) return false;

  if (body.visibility === "confidential") {
    return (
      actor.memberBodyIds.has(bodyId) ||
      actor.historicalBodyIds.has(bodyId) ||
      (body.termId !== org.termId && !!body.lineageKey && actor.memberLineages.has(body.lineageKey)) ||
      actor.system.has("governance_admin")
    );
  }
  if (body.termId !== org.termId) return canViewArchivedBodyWork(actor, org, body);

  if (actor.isMC) return true;
  if (actor.memberBodyIds.has(bodyId)) return true;
  if (leadsBody(actor, org, bodyId)) return true;
  // Synergy teams / projects: leaders of the linked bodies can follow the shared tracker.
  for (const linked of org.links.get(bodyId) ?? []) if (leadsBody(actor, org, linked)) return true;
  return false;
}

function canViewArchivedBodyWork(actor: Actor, org: Org, body: Body): boolean {
  if (actor.isMC) return true;
  if (actor.historicalBodyIds.has(body.id)) return true;
  if (body.lineageKey && actor.memberLineages.has(body.lineageKey)) return true;
  for (const id of [body.id, ...ancestorsOf(org, body.id)]) {
    const k = org.bodies.get(id)?.lineageKey;
    if (k && actor.ledLineages.has(k)) return true;
  }
  return false;
}

/** Can the actor add rows / log progress in this body's trackers. */
export function canContributeToBody(actor: Actor, org: Org, bodyId: string): boolean {
  const body = org.bodies.get(bodyId);
  if (!body || body.termId !== org.termId || body.status === "closed") return false;
  return actor.memberBodyIds.has(bodyId) || leadsBody(actor, org, bodyId);
}

/** Can the actor configure this body: trackers, KPIs, positions, edit anyone's rows. */
export function canManageBody(actor: Actor, org: Org, bodyId: string): boolean {
  const body = org.bodies.get(bodyId);
  if (!body || body.termId !== org.termId) return false;
  if (body.visibility === "confidential" && !actor.memberBodyIds.has(bodyId)) return actor.system.has("governance_admin");
  return leadsBody(actor, org, bodyId) || actor.system.has("im_admin") || actor.system.has("system_admin");
}

// ───────────── people rules ─────────────

/** Bodies (current term) where the target holds a position. */
export function bodiesOfUser(org: Org, userId: string): string[] {
  return (org.userPositions.get(userId) ?? [])
    .map((pid) => org.positions.get(pid)?.bodyId)
    .filter((b): b is string => !!b && org.bodies.get(b)?.termId === org.termId);
}

/** Actor leads the target: target sits below a body the actor leads (co-leaders of the same body don't lead each other). */
export function leadsUser(actor: Actor, org: Org, userId: string): boolean {
  if (userId === actor.id) return false;
  for (const pid of org.userPositions.get(userId) ?? []) {
    const p = org.positions.get(pid);
    const b = p && org.bodies.get(p.bodyId);
    if (!p || !b || b.termId !== org.termId) continue;
    if (ancestorsOf(org, b.id).some((a) => actor.ledBodyIds.has(a))) return true;
    if (actor.ledBodyIds.has(b.id) && !p.isLeader) return true;
  }
  return false;
}

export function canAssignTaskTo(actor: Actor, org: Org, userId: string): boolean {
  if (actor.isExternal) return false;
  if (userId === actor.id) return true;
  if (actor.isMC) return true;
  return leadsUser(actor, org, userId);
}

export type FieldVisibility = "internal" | "restricted" | "private";

export function canSeeField(actor: Actor, org: Org, targetUserId: string, visibility: FieldVisibility): boolean {
  if (actor.id === targetUserId) return true;
  if (actor.isExternal) return false;
  if (visibility === "internal") return true;
  if (visibility === "private") return false;
  return actor.isMC || leadsUser(actor, org, targetUserId) || actor.system.has("mx_admin");
}

/** Performance reviews: the person, their leadership chain, MX admin, MCP. Never peers. */
export function canViewReviewsOf(actor: Actor, org: Org, targetUserId: string): boolean {
  if (actor.id === targetUserId) return true;
  return actor.isMCP || actor.system.has("mx_admin") || leadsUser(actor, org, targetUserId);
}

/**
 * Supervisor chain used for escalation and approvals:
 * position.reportsTo → holders, then their reportsTo, … (falls back to body leaders up the tree).
 */
export function supervisorChain(org: Org, userId: string, maxLevels = 5): string[][] {
  const levels: string[][] = [];
  const seenUsers = new Set<string>([userId]);
  let frontier = (org.userPositions.get(userId) ?? []).map((pid) => org.positions.get(pid)).filter((p): p is Position => !!p && org.bodies.get(p.bodyId)?.termId === org.termId);
  // Prefer the "primary" (non-OC, non-synergy) positions for line management.
  const primary = frontier.filter((p) => !["oc", "synergy", "project"].includes(org.bodies.get(p.bodyId)!.type));
  if (primary.length) frontier = primary;

  for (let i = 0; i < maxLevels && frontier.length; i++) {
    const next: Position[] = [];
    const level = new Set<string>();
    for (const p of frontier) {
      let sup = p.reportsToId ? org.positions.get(p.reportsToId) : undefined;
      if (!sup) {
        // Fallback: a leader position in the same body (if p is not the leader) or in the parent body.
        const body = org.bodies.get(p.bodyId)!;
        const candidates = [...org.positions.values()].filter((q) => q.isLeader && (p.isLeader ? q.bodyId === body.parentId : q.bodyId === body.id) && q.id !== p.id);
        sup = candidates[0];
      }
      if (!sup) continue;
      next.push(sup);
      for (const u of org.holders.get(sup.id) ?? []) if (!seenUsers.has(u)) level.add(u);
    }
    for (const u of level) seenUsers.add(u);
    if (level.size) levels.push([...level]);
    frontier = next;
  }
  return levels;
}

// ───────────── documents ─────────────

export type DocLike = { classification: Classification; bodyId: string; ownerId: string | null; termId: string };

export function canViewDocument(actor: Actor, org: Org, doc: DocLike): boolean {
  if (doc.classification === "external") return true;
  if (actor.isExternal) return false;
  if (doc.ownerId === actor.id) return true;

  const confidentialBody = org.bodies.get(doc.bodyId)?.visibility === "confidential";

  switch (doc.classification) {
    case "internal":
      return true;
    case "body":
      return canViewBodyWork(actor, org, doc.bodyId);
    case "leadership":
      if (confidentialBody) return canViewBodyWork(actor, org, doc.bodyId);
      if (actor.isMC) return true;
      if (doc.termId === org.termId) return leadsBody(actor, org, doc.bodyId);
      return [doc.bodyId, ...ancestorsOf(org, doc.bodyId)].some((id) => {
        const k = org.bodies.get(id)?.lineageKey;
        return !!k && actor.ledLineages.has(k);
      });
    case "mc":
      return actor.isMC;
    case "mcp":
      return actor.isMCP;
    case "governance":
      return actor.isGovernance || actor.isMCP || actor.system.has("governance_admin");
    case "confidential_hr":
      return actor.isMCP || actor.system.has("mx_admin");
    case "confidential_finance":
      return actor.isMCP || actor.system.has("fnl_admin") || (actor.isMC && actor.departmentKeys.has("FNL"));
    default:
      return false;
  }
}

/** Classifications this actor is allowed to assign when uploading into a body. */
export function allowedClassifications(actor: Actor, org: Org, bodyId: string): Classification[] {
  const out: Classification[] = ["internal", "body"];
  if (leadsBody(actor, org, bodyId) || actor.isMC) out.push("leadership");
  if (actor.isMC) out.push("mc", "external");
  if (actor.isMCP) out.push("mcp");
  if (actor.isGovernance || actor.isMCP || actor.system.has("governance_admin")) out.push("governance");
  if (actor.isMCP || actor.system.has("mx_admin")) out.push("confidential_hr");
  if (actor.isMCP || actor.system.has("fnl_admin") || (actor.isMC && actor.departmentKeys.has("FNL"))) out.push("confidential_finance");
  return out;
}

// ───────────── audiences (announcements, posts, events) ─────────────

export type Audience = "national" | "body" | "leadership" | "external";

export function inAudience(actor: Actor, org: Org, audience: Audience, bodyId: string | null): boolean {
  if (audience === "external") return true;
  if (actor.isExternal) return false;
  if (audience === "national") return true;
  if (!bodyId) return audience === "leadership" ? actor.isLeader || actor.isMC : true;
  const subtree = subtreeOf(org, bodyId);
  if (audience === "body") return actor.isMC || [...actor.memberBodyIds].some((b) => subtree.has(b)) || leadsBody(actor, org, bodyId);
  // leadership of a subtree
  return actor.isMC || [...actor.ledBodyIds].some((b) => subtree.has(b)) || leadsBody(actor, org, bodyId);
}

export function canPublishTo(actor: Actor, org: Org, audience: Audience, bodyId: string | null): boolean {
  if (actor.isExternal) return false;
  if (audience === "national" || audience === "external") return actor.isMC;
  if (!bodyId) return actor.isMC;
  return actor.isMC || leadsBody(actor, org, bodyId);
}
