/**
 * Permission rules verified against the seeded organisation (run `npm run db:reset` first).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, s, sql } from "../src/db";
import {
  buildActor, canAssignTaskTo, canManageBody, canSeeField, canViewBodyWork, canViewDocument, canViewReviewsOf, inAudience, supervisorChain,
  type Actor, type Org,
} from "../src/lib/access";
import { historicalPositionIds, loadOrgData, systemRolesOf } from "../src/lib/org";

let org: Org;
const actors = new Map<string, Actor>();
const ids = new Map<string, string>();

async function actor(handle: string): Promise<Actor> {
  if (actors.has(handle)) return actors.get(handle)!;
  const [u] = await db.select().from(s.users).where(eq(s.users.email, `${handle}@example.org`));
  assert.ok(u, `user ${handle}`);
  ids.set(handle, u.id);
  const a = buildActor(org, u, await systemRolesOf(u.id), await historicalPositionIds(u.id));
  actors.set(handle, a);
  return a;
}
const uid = (h: string) => ids.get(h)!;
function body(name: string, termCode = "26.27"): string {
  const term = [...org.bodies.values()].find((b) => b.type === "entity" && b.name.endsWith(termCode))!.termId;
  const b = [...org.bodies.values()].find((x) => x.name === name && x.termId === term);
  assert.ok(b, `body ${name} ${termCode}`);
  return b.id;
}

before(async () => {
  org = await loadOrgData();
  for (const h of ["firoz", "nadia", "arif", "rafi", "maliha", "lcp_ds", "lcp_dn", "lcvp_ogx", "lcvp_mkt", "lcvp_ogx_dn", "tl_ogx1", "tl_mkt1", "karim", "sumaiya", "joya", "ecb1", "ecb2", "boa", "rakib", "ocp", "est1"]) await actor(h);
});
after(async () => {
  await sql.end();
});

describe("role detection", () => {
  it("MCP leads the whole entity and is MC", () => {
    const a = actors.get("firoz")!;
    assert.equal(a.isMCP, true);
    assert.equal(a.isMC, true);
  });
  it("MCVP is MC but not MCP; LCP is neither", () => {
    assert.equal(actors.get("nadia")!.isMC, true);
    assert.equal(actors.get("nadia")!.isMCP, false);
    assert.equal(actors.get("lcp_ds")!.isMC, false);
  });
  it("member is not a leader; external accounts are external", () => {
    assert.equal(actors.get("karim")!.isLeader, false);
    assert.equal(actors.get("boa")!.isExternal, true);
  });
});

describe("tracker / body work visibility", () => {
  it("team member sees own team, not the LC department or another LC", () => {
    const k = actors.get("karim")!;
    assert.equal(canViewBodyWork(k, org, body("oGX Team 1 — Dhaka South")), true);
    assert.equal(canViewBodyWork(k, org, body("oGX — Dhaka South")), false);
    assert.equal(canViewBodyWork(k, org, body("oGX — Dhaka North")), false);
  });
  it("TL sees team; LCVP sees department + teams; LCP sees whole LC but not other LCs", () => {
    assert.equal(canViewBodyWork(actors.get("tl_ogx1")!, org, body("oGX Team 1 — Dhaka South")), true);
    assert.equal(canViewBodyWork(actors.get("lcvp_ogx")!, org, body("oGX Team 1 — Dhaka South")), true);
    assert.equal(canViewBodyWork(actors.get("lcvp_ogx")!, org, body("BD — Dhaka South")), false);
    assert.equal(canViewBodyWork(actors.get("lcp_ds")!, org, body("BD — Dhaka South")), true);
    assert.equal(canViewBodyWork(actors.get("lcp_ds")!, org, body("oGX — Dhaka North")), false);
  });
  it("every MC member can read every standard tracker in the entity", () => {
    for (const h of ["nadia", "arif", "rafi"]) {
      assert.equal(canViewBodyWork(actors.get(h)!, org, body("oGX Team 1 — Dhaka South")), true, h);
      assert.equal(canViewBodyWork(actors.get(h)!, org, body("MKT — Dhaka South")), true, h);
      assert.equal(canViewBodyWork(actors.get(h)!, org, body("National Leadership Development Seminar 2026 — OC")), true, h);
    }
  });
  it("MC can read but not manage an LC department (LCVP manages it)", () => {
    assert.equal(canManageBody(actors.get("nadia")!, org, body("oGX — Dhaka South")), false);
    assert.equal(canManageBody(actors.get("lcvp_ogx")!, org, body("oGX — Dhaka South")), true);
    assert.equal(canManageBody(actors.get("firoz")!, org, body("oGX — Dhaka South")), true);
  });
  it("governance boards are confidential: not even the MCP sees ECB work", () => {
    assert.equal(canViewBodyWork(actors.get("firoz")!, org, body("ECB 26.27")), false);
    assert.equal(canViewBodyWork(actors.get("ecb2")!, org, body("ECB 26.27")), true);
  });
  it("synergy tracker is visible to leaders of both linked departments and to its members", () => {
    const syn = body("oGX × MKT Campaign Synergy — Dhaka South");
    assert.equal(canViewBodyWork(actors.get("lcvp_ogx")!, org, syn), true);
    assert.equal(canViewBodyWork(actors.get("lcvp_mkt")!, org, syn), true);
    assert.equal(canViewBodyWork(actors.get("joya")!, org, syn), true);
    assert.equal(canViewBodyWork(actors.get("karim")!, org, syn), false);
  });
  it("OC members see the OC tracker; external accounts see nothing", () => {
    assert.equal(canViewBodyWork(actors.get("rakib")!, org, body("National Leadership Development Seminar 2026 — OC")), true);
    assert.equal(canViewBodyWork(actors.get("boa")!, org, body("MC 26.27")), false);
  });
});

describe("archive (25.26)", () => {
  it("MC 26.27 reads MC 25.26 department archives", () => {
    assert.equal(canViewBodyWork(actors.get("arif")!, org, body("MC oGX", "25.26")), true);
  });
  it("LCVP oGX 26.27 inherits the 25.26 oGX archive of the same LC by lineage, not other departments", () => {
    assert.equal(canViewBodyWork(actors.get("lcvp_ogx")!, org, body("oGX — Dhaka South", "25.26")), true);
    assert.equal(canViewBodyWork(actors.get("lcvp_ogx")!, org, body("oGX Team 1 — Dhaka South", "25.26")), true);
    assert.equal(canViewBodyWork(actors.get("lcvp_ogx")!, org, body("BD — Dhaka South", "25.26")), false);
  });
  it("a member does not get archives of bodies above them", () => {
    assert.equal(canViewBodyWork(actors.get("sumaiya")!, org, body("oGX — Dhaka South", "25.26")), false);
  });
});

describe("documents", () => {
  it("confidential finance: MCP, FNL admin, MCVP FNL — not other MCVPs", async () => {
    const [doc] = await db.select().from(s.documents).where(eq(s.documents.title, "Audited Accounts 25.26"));
    assert.equal(canViewDocument(actors.get("firoz")!, org, doc!), true);
    assert.equal(canViewDocument(actors.get("arif")!, org, doc!), true);
    assert.equal(canViewDocument(actors.get("nadia")!, org, doc!), false);
    assert.equal(canViewDocument(actors.get("lcp_ds")!, org, doc!), false);
  });
  it("governance documents: governance members + MCP only", async () => {
    const [doc] = await db.select().from(s.documents).where(eq(s.documents.title, "ECB Compliance Review 25.26"));
    assert.equal(canViewDocument(actors.get("ecb2")!, org, doc!), true);
    assert.equal(canViewDocument(actors.get("firoz")!, org, doc!), true);
    assert.equal(canViewDocument(actors.get("nadia")!, org, doc!), false);
  });
  it("leadership handover docs are visible to the MC but not to members", async () => {
    const [doc] = await db.select().from(s.documents).where(eq(s.documents.title, "oGX Handover 25.26 → 26.27"));
    assert.equal(canViewDocument(actors.get("nadia")!, org, doc!), true);
    assert.equal(canViewDocument(actors.get("karim")!, org, doc!), false);
  });
  it("internal documents are visible to every internal user, never to BOA", async () => {
    const [doc] = await db.select().from(s.documents).where(eq(s.documents.title, "Constitution of AIESEC in Bangladesh"));
    assert.equal(canViewDocument(actors.get("karim")!, org, doc!), true);
    assert.equal(canViewDocument(actors.get("boa")!, org, doc!), false);
  });
});

describe("people", () => {
  it("restricted fields: self, leadership chain and MC — not peers", () => {
    assert.equal(canSeeField(actors.get("tl_ogx1")!, org, uid("karim"), "restricted"), true);
    assert.equal(canSeeField(actors.get("nadia")!, org, uid("karim"), "restricted"), true);
    assert.equal(canSeeField(actors.get("sumaiya")!, org, uid("karim"), "restricted"), false);
    assert.equal(canSeeField(actors.get("sumaiya")!, org, uid("karim"), "private"), false);
  });
  it("reviews: chain + MX admin, never peers or other MCVPs", () => {
    assert.equal(canViewReviewsOf(actors.get("tl_ogx1")!, org, uid("karim")), true);
    assert.equal(canViewReviewsOf(actors.get("maliha")!, org, uid("karim")), true);
    assert.equal(canViewReviewsOf(actors.get("sumaiya")!, org, uid("karim")), false);
    assert.equal(canViewReviewsOf(actors.get("arif")!, org, uid("karim")), false);
  });
  it("task assignment follows hierarchy; MC can assign anyone; members cannot assign upwards", () => {
    assert.equal(canAssignTaskTo(actors.get("tl_ogx1")!, org, uid("karim")), true);
    assert.equal(canAssignTaskTo(actors.get("nadia")!, org, uid("lcvp_ogx_dn")), true);
    assert.equal(canAssignTaskTo(actors.get("karim")!, org, uid("tl_ogx1")), false);
    assert.equal(canAssignTaskTo(actors.get("lcvp_ogx")!, org, uid("lcvp_mkt")), false);
  });
  it("supervisor chain: member → TL → LCVP → LCP → MCP", () => {
    const chain = supervisorChain(org, uid("karim"));
    assert.deepEqual(chain.slice(0, 4), [[uid("tl_ogx1")], [uid("lcvp_ogx")], [uid("lcp_ds")], [uid("firoz")]]);
  });
  it("announcement audiences", () => {
    const ds = body("AIESEC in Dhaka South");
    assert.equal(inAudience(actors.get("karim")!, org, "body", ds), true);
    assert.equal(inAudience(actors.get("lcvp_ogx_dn")!, org, "body", ds), false);
    assert.equal(inAudience(actors.get("karim")!, org, "leadership", ds), false);
    assert.equal(inAudience(actors.get("tl_ogx1")!, org, "leadership", ds), true);
    assert.equal(inAudience(actors.get("boa")!, org, "national", null), false);
  });
});
