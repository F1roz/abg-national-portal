/**
 * Demo data: AIESEC in Bangladesh with a closed term (25.26, fully archived) and the active term (26.27).
 * All people are fictional demo accounts. Password for every demo account: see DEMO_PASSWORD below.
 */
import bcrypt from "bcryptjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, s, sql } from "./index";
import type { JobDescription, RoleKey } from "./schema";
import { createBody, createPosition } from "../lib/provision";
import { addDays, localDate, randomToken, sha256 } from "../lib/util";

const DEMO_PASSWORD = "Portal#2026demo";
const today = localDate();
const daysFromNow = (n: number, hour = 18) => new Date(Date.now() + n * 86_400_000 + (hour - new Date().getUTCHours() - 6) * 3_600_000);

const MC_DEPTS = [
  { key: "OGX", name: "Outgoing Exchange", short: "oGX" },
  { key: "ICX", name: "Incoming Exchange", short: "iCX" },
  { key: "BD", name: "Business Development", short: "BD" },
  { key: "MKT", name: "Marketing", short: "MKT" },
  { key: "FNL", name: "Finance & Legal", short: "FNL" },
  { key: "MX", name: "Member Experience", short: "MX" },
  { key: "IM", name: "Information Management", short: "IM" },
] as const;
const LC_DEPTS = ["OGX", "ICX", "BD", "MKT", "FNL", "MX"] as const;
const LCS = [
  { key: "dhaka-south", name: "AIESEC in Dhaka South", short: "Dhaka South" },
  { key: "dhaka-north", name: "AIESEC in Dhaka North", short: "Dhaka North" },
  { key: "chittagong", name: "AIESEC in Chittagong", short: "Chittagong" },
  { key: "sylhet", name: "AIESEC in Sylhet", short: "Sylhet" },
];
const short = (k: string) => MC_DEPTS.find((d) => d.key === k)!.short;

function jdFor(title: string, kpis: string[], extra: Partial<JobDescription> = {}): JobDescription {
  return {
    purpose: `Lead and deliver the ${title} mandate for the term in line with the national strategy.`,
    responsibilities: ["Set and track the term plan", "Run weekly team rhythm and reporting", "Develop the people you lead", "Report progress and risks upwards"],
    kpis,
    competencies: [
      { name: "Execution", level: 4 }, { name: "People leadership", level: 3 }, { name: "Strategic thinking", level: 3 }, { name: "Stakeholder management", level: 3 },
    ],
    authorities: ["Assign tasks within your scope", "Approve leave of direct reports"],
    deliverables: ["Term plan", "Weekly report", "End-of-term handover"],
    workingRhythm: "Weekly team meeting, weekly report every Monday, monthly review.",
    evaluationCriteria: ["KPI achievement", "Team health", "Reporting consistency"],
    ...extra,
  };
}

async function main() {
  const existing = await db.select().from(s.terms).limit(1);
  if (existing.length) {
    console.log("Database already seeded — run `npm run db:reset` to start over.");
    await sql.end();
    return;
  }
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const userIds = new Map<string, string>();

  async function user(handle: string, name: string, extra: Partial<typeof s.users.$inferInsert> = {}) {
    const [u] = await db
      .insert(s.users)
      .values({
        email: `${handle}@example.org`, name, passwordHash, status: "active", university: extra.university ?? "University of Dhaka",
        termsAcceptedAt: new Date(), profileCompletedAt: new Date(), joinedAt: "2024-03-01", phone: `+8801${Math.floor(700000000 + Math.random() * 99999999)}`,
        skills: [], languages: ["Bangla", "English"], ...extra,
      })
      .returning();
    userIds.set(handle, u!.id);
    return u!.id;
  }
  const U = (h: string) => userIds.get(h)!;

  // ── People ──
  await user("firoz", "Firoz Ahmed", { preferredName: "Firoz", skills: ["Strategy", "Partnerships", "Public speaking"] });
  const mcvps: Record<string, string> = { OGX: "nadia", ICX: "tanvir", BD: "shakib", MKT: "shristi", FNL: "arif", MX: "maliha", IM: "rafi" };
  const mcvpNames: Record<string, string> = { nadia: "Nadia Islam", tanvir: "Tanvir Hasan", shakib: "Shakib Rahman", shristi: "Shristi Shrestha", arif: "Arif Chowdhury", maliha: "Maliha Karim", rafi: "Rafi Uddin" };
  for (const h of Object.values(mcvps)) await user(h, mcvpNames[h]!, { skills: ["Leadership", "Project management"] });
  for (const [h, n] of [["lcp_ds", "Imran Hossain"], ["lcp_dn", "Farhana Akter"], ["lcp_ctg", "Sabbir Ahmed"], ["lcp_syl", "Nusrat Jahan"]] as const) await user(h, n);
  const dsLcvps: Record<string, [string, string]> = {
    OGX: ["lcvp_ogx", "Rahim Uddin"], ICX: ["lcvp_icx", "Ayesha Siddiqua"], BD: ["lcvp_bd", "Mahmud Hasan"],
    MKT: ["lcvp_mkt", "Tasnim Ferdous"], FNL: ["lcvp_fnl", "Kamal Hossain"], MX: ["lcvp_mx", "Rumana Afroz"],
  };
  for (const [h, n] of Object.values(dsLcvps)) await user(h, n);
  await user("lcvp_ogx_dn", "Zahid Hasan");
  await user("lcvp_ogx_ctg", "Mehedi Hasan");
  await user("tl_ogx1", "Sara Rahman", { skills: ["Sales", "Canva"] });
  await user("tl_mkt1", "Ahmed Kabir", { skills: ["Content", "Photography"] });
  for (const [h, n] of [["karim", "Karim Mia"], ["sumaiya", "Sumaiya Akter"], ["rakib", "Rakib Hasan"], ["joya", "Joya Das"], ["ovi", "Ovi Rahman"], ["priya", "Priya Saha"], ["nabil", "Nabil Ahmed"], ["lamia", "Lamia Haque"]] as const) {
    await user(h, n, { university: ["University of Dhaka", "BUET", "North South University", "BRAC University"][Math.floor(Math.random() * 4)] });
  }
  for (const [h, n] of [["ecb1", "Hasan Mahmud"], ["ecb2", "Sadia Noor"], ["esc1", "Tahmid Khan"], ["efb1", "Rezaul Karim"], ["est1", "Anika Tabassum"], ["est2", "Fahim Shahriar"]] as const) await user(h, n);
  await user("ocp", "Mithila Sen");
  await user("boa", "Dr. Kamrul Alam", { userType: "boa" });
  await user("partner", "Partner Liaison (Demo Corp)", { userType: "partner" });
  await user("alumna", "Lubna Yasmin", { status: "alumni" });

  // System roles — separation of duties, no "see everything" account.
  await db.insert(s.systemRoles).values([
    { userId: U("rafi"), role: "system_admin" }, { userId: U("rafi"), role: "im_admin" },
    { userId: U("maliha"), role: "mx_admin" }, { userId: U("maliha"), role: "recruitment_admin" },
    { userId: U("arif"), role: "fnl_admin" }, { userId: U("ecb1"), role: "governance_admin" },
  ]);

  // ── Terms ──
  const [t2526] = await db.insert(s.terms).values({ code: "25.26", name: "Term 2025.26", startsOn: "2025-07-01", endsOn: "2026-06-30", status: "active" }).returning();
  const [t2627] = await db.insert(s.terms).values({ code: "26.27", name: "Term 2026.27", startsOn: "2026-07-01", endsOn: "2027-06-30", status: "planning" }).returning();

  // ── Build one term's structure ──
  async function buildTerm(termId: string, code: string, staff: Record<string, string | string[]>) {
    const posBy: Record<string, string> = {};
    const bodyBy: Record<string, string> = {};
    const assign = async (positionId: string, handles: string | string[] | undefined) => {
      for (const h of [handles ?? []].flat()) {
        if (!userIds.has(h)) continue;
        await db.insert(s.assignments).values({ userId: U(h), positionId, termId, active: true, startsOn: code === "26.27" ? "2026-07-01" : "2025-07-01" });
      }
    };

    const entity = await createBody({ termId, type: "entity", name: `AIESEC in Bangladesh ${code}`, shortName: "AIESEC in Bangladesh", lineageKey: "entity", withTracker: false });
    bodyBy.entity = entity.id;
    const mc = await createBody({ termId, type: "mc", name: `MC ${code}`, shortName: `MC ${code}`, parentId: entity.id, lineageKey: "mc", trackerTemplate: "risk", description: "Member Committee — national executive team." });
    bodyBy.mc = mc.id;
    const mcp = await createPosition({ bodyId: mc.id, title: "MCP", roleKey: "mcp", isLeader: true, sortOrder: 1, jd: jdFor("MCP", ["Entity health score", "National strategy achievement", "Exchange growth"], { purpose: "Lead AIESEC in Bangladesh and its MC towards the national strategy." }) });
    posBy.mcp = mcp.id;
    await assign(mcp.id, staff.mcp);

    for (const d of MC_DEPTS) {
      const body = await createBody({ termId, type: "department", name: `MC ${d.short}`, shortName: `MC ${d.short}`, parentId: mc.id, departmentKey: d.key, lineageKey: `mc-${d.key.toLowerCase()}` });
      bodyBy[`mc-${d.key}`] = body.id;
      const p = await createPosition({ bodyId: body.id, title: `MCVP ${d.short}`, roleKey: "mcvp", isLeader: true, reportsToId: mcp.id, sortOrder: 2, jd: jdFor(`MCVP ${d.short}`, [`National ${d.short} target`, "LC support", "Portfolio team performance"]) });
      posBy[`mcvp-${d.key}`] = p.id;
      await assign(p.id, staff[`mcvp-${d.key}`]);
    }

    const est = await createBody({ termId, type: "support", name: `Entity Support Team ${code}`, shortName: "EST", parentId: entity.id, lineageKey: "est" });
    bodyBy.est = est.id;
    const estP = await createPosition({ bodyId: est.id, title: "EST Member", roleKey: "est", reportsToId: mcp.id, multiHolder: true, sortOrder: 5 });
    await assign(estP.id, staff.est);

    for (const g of [{ k: "ecb", n: "Entity Compliance Board", r: "ecb" as RoleKey }, { k: "esc", n: "Entity Support Council", r: "esc" as RoleKey }, { k: "efb", n: "Entity Finance Board", r: "efb" as RoleKey }]) {
      const gb = await createBody({ termId, type: "governance", name: `${g.k.toUpperCase()} ${code}`, shortName: g.k.toUpperCase(), parentId: entity.id, lineageKey: g.k, description: g.n });
      bodyBy[g.k] = gb.id;
      const chair = await createPosition({ bodyId: gb.id, title: `${g.k.toUpperCase()} Chair`, roleKey: g.r, isLeader: true, sortOrder: 3 });
      const member = await createPosition({ bodyId: gb.id, title: `${g.k.toUpperCase()} Member`, roleKey: g.r, reportsToId: chair.id, multiHolder: true, sortOrder: 4 });
      await assign(chair.id, staff[`${g.k}-chair`]);
      await assign(member.id, staff[`${g.k}-member`]);
    }

    for (const lc of LCS) {
      const lcBody = await createBody({ termId, type: "lc", name: lc.name, shortName: lc.short, parentId: entity.id, lineageKey: `lc-${lc.key}` });
      bodyBy[`lc-${lc.key}`] = lcBody.id;
      const lcp = await createPosition({ bodyId: lcBody.id, title: "LCP", roleKey: "lcp", isLeader: true, reportsToId: mcp.id, sortOrder: 10, jd: jdFor("LCP", ["LC health score", "LC exchange target", "Membership retention"]) });
      posBy[`lcp-${lc.key}`] = lcp.id;
      await assign(lcp.id, staff[`lcp-${lc.key}`]);
      for (const dk of LC_DEPTS) {
        const dept = await createBody({ termId, type: "department", name: `${short(dk)} — ${lc.short}`, shortName: short(dk), parentId: lcBody.id, departmentKey: dk, lineageKey: `lc-${lc.key}-${dk.toLowerCase()}` });
        bodyBy[`lc-${lc.key}-${dk}`] = dept.id;
        const lcvp = await createPosition({ bodyId: dept.id, title: `LCVP ${short(dk)}`, roleKey: "lcvp", isLeader: true, reportsToId: lcp.id, sortOrder: 11, jd: jdFor(`LCVP ${short(dk)}`, [`LC ${short(dk)} target`, "Team productivity", "Retention"]) });
        posBy[`lcvp-${lc.key}-${dk}`] = lcvp.id;
        await assign(lcvp.id, staff[`lcvp-${lc.key}-${dk}`]);
        if (["OGX", "MKT"].includes(dk) && (lc.key === "dhaka-south" || dk === "OGX")) {
          const team = await createBody({ termId, type: "team", name: `${short(dk)} Team 1 — ${lc.short}`, shortName: `${short(dk)} Team 1`, parentId: dept.id, departmentKey: dk, lineageKey: `lc-${lc.key}-${dk.toLowerCase()}-t1` });
          bodyBy[`team-${lc.key}-${dk}`] = team.id;
          const tl = await createPosition({ bodyId: team.id, title: `TL ${short(dk)}`, roleKey: "tl", isLeader: true, reportsToId: lcvp.id, sortOrder: 12, jd: jdFor(`TL ${short(dk)}`, ["Team KPI achievement", "Team retention", "Education completion"]) });
          const mem = await createPosition({ bodyId: team.id, title: `Member ${short(dk)}`, roleKey: "member", reportsToId: tl.id, multiHolder: true, sortOrder: 13, jd: jdFor(`Member ${short(dk)}`, ["Personal KPI", "Daily reporting", "Education"], { purpose: `Contribute to the ${short(dk)} team's goals and grow as a leader.` }) });
          posBy[`tl-${lc.key}-${dk}`] = tl.id;
          posBy[`member-${lc.key}-${dk}`] = mem.id;
          await assign(tl.id, staff[`tl-${lc.key}-${dk}`]);
          await assign(mem.id, staff[`member-${lc.key}-${dk}`]);
        }
      }
    }
    return { posBy, bodyBy };
  }

  // 25.26 staffing (some people were in different positions — this becomes their AIESEC journey)
  const old = await buildTerm(t2526!.id, "25.26", {
    mcp: "alumna", "mcvp-OGX": "firoz", "mcvp-ICX": "tanvir", "mcvp-BD": "lcp_dn", "mcvp-MKT": "shristi", "mcvp-FNL": "arif", "mcvp-MX": "maliha", "mcvp-IM": "rafi",
    "lcp-dhaka-south": "shakib", "lcvp-dhaka-south-OGX": "nadia", "lcvp-dhaka-south-MKT": "lcvp_mkt", "tl-dhaka-south-OGX": "lcvp_ogx",
    "member-dhaka-south-OGX": ["tl_ogx1", "karim"], "tl-dhaka-south-MKT": "tl_mkt1", "ecb-chair": "ecb1", "ecb-member": ["ecb2"], "est": ["est1"],
  });

  // Archive content for 25.26 — documents, numbers and lessons per department.
  const storageDir = path.resolve(process.env.STORAGE_DIR ?? "./storage");
  async function textFile(name: string, content: string, by: string) {
    const key = path.join("seed", `${randomToken(12)}.txt`);
    await mkdir(path.join(storageDir, "seed"), { recursive: true });
    await writeFile(path.join(storageDir, key), content);
    const [f] = await db.insert(s.files).values({ storageKey: key, originalName: name, mimeType: "text/plain", size: Buffer.byteLength(content), sha256: sha256(content), uploadedById: U(by) }).returning();
    return f!.id;
  }
  const oldNumbers: Record<string, { name: string; target: number; actual: number; key: string }[]> = {
    OGX: [{ name: "Applications", target: 600, actual: 512, key: "ogx.applications" }, { name: "Approvals", target: 180, actual: 141, key: "ogx.approvals" }, { name: "Realisations", target: 120, actual: 97, key: "ogx.realisations" }],
    ICX: [{ name: "Approvals", target: 120, actual: 88, key: "icx.approvals" }, { name: "Realisations", target: 90, actual: 71, key: "icx.realisations" }],
    BD: [{ name: "Partnerships won", target: 40, actual: 33, key: "bd.partnerships" }, { name: "Revenue won", target: 3_000_000, actual: 2_450_000, key: "bd.revenue" }],
    MKT: [{ name: "Leads generated", target: 12_000, actual: 13_400, key: "mkt.leads" }],
    FNL: [{ name: "Income", target: 4_000_000, actual: 3_620_000, key: "fnl.income" }],
    MX: [{ name: "Member retention %", target: 80, actual: 74, key: "mx.retention" }],
    IM: [{ name: "Reporting compliance %", target: 90, actual: 81, key: "im.reporting" }],
  };
  const oldOwner: Record<string, string> = { OGX: "firoz", ICX: "tanvir", BD: "lcp_dn", MKT: "shristi", FNL: "arif", MX: "maliha", IM: "rafi" };
  for (const d of MC_DEPTS) {
    const bodyId = old.bodyBy[`mc-${d.key}`]!;
    const owner = oldOwner[d.key]!;
    // Replace template KPIs with the real end-of-term numbers.
    await db.delete(s.kpis).where(eq(s.kpis.bodyId, bodyId));
    for (const n of oldNumbers[d.key]!) {
      const [k] = await db.insert(s.kpis).values({ bodyId, termId: t2526!.id, name: n.name, target: n.target, unit: n.key.includes("revenue") || n.key.includes("income") ? "BDT" : n.key.includes("%") || n.name.includes("%") ? "%" : "count", source: "manual", departmentKey: d.key, metricKey: n.key }).returning();
      // Monthly entries so trends can be charted across terms.
      const months = ["2025-07-31", "2025-08-31", "2025-09-30", "2025-10-31", "2025-11-30", "2025-12-31", "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"];
      const isRate = n.name.includes("%");
      let left = n.actual;
      for (let i = 0; i < months.length; i++) {
        const v = isRate ? (i === months.length - 1 ? n.actual : 0) : i === months.length - 1 ? left : Math.round((n.actual / months.length) * (0.6 + Math.random() * 0.8));
        if (!isRate) left -= v;
        if (v) await db.insert(s.kpiEntries).values({ kpiId: k!.id, value: v, occurredOn: months[i]!, source: "import", note: "Imported from 25.26 tracker", createdById: U(owner) });
      }
    }
    const docs: [string, (typeof s.documents.$inferInsert)["category"], (typeof s.documents.$inferInsert)["classification"], string][] = [
      [`${d.short} Term Strategy 25.26`, "strategy", "body", `${d.name} strategy for 25.26.\n\nPriorities:\n1. Grow the funnel through university partnerships\n2. Standardise weekly reporting\n3. Build the next leadership pipeline`],
      [`${d.short} End-of-Term Report 25.26`, "report", "body", `${d.name} end-of-term report.\n\n${oldNumbers[d.key]!.map((n) => `${n.name}: ${n.actual} / ${n.target}`).join("\n")}`],
      [`${d.short} Playbook & SOPs`, "playbook", "internal", `How ${d.short} works in AIESEC in Bangladesh: weekly rhythm, templates and scripts.`],
      [`${d.short} Handover 25.26 → 26.27`, "handover", "leadership", `Handover notes from MCVP ${d.short} 25.26: stakeholders, open risks, pending deals, recommendations.`],
    ];
    for (const [title, category, classification, content] of docs) {
      const fileId = await textFile(`${title}.txt`, content, owner);
      await db.insert(s.documents).values({ title, category, classification, fileId, termId: t2526!.id, bodyId, ownerId: U(owner), tags: [d.short, "25.26"] });
    }
  }
  const finConf = await textFile("Audited accounts 25.26.txt", "Audited financial statements — confidential.", "arif");
  await db.insert(s.documents).values({ title: "Audited Accounts 25.26", category: "report", classification: "confidential_finance", fileId: finConf, termId: t2526!.id, bodyId: old.bodyBy["mc-FNL"]!, ownerId: U("arif") });
  const ecbDoc = await textFile("ECB compliance review 25.26.txt", "ECB compliance review findings for 25.26.", "ecb1");
  await db.insert(s.documents).values({ title: "ECB Compliance Review 25.26", category: "report", classification: "governance", fileId: ecbDoc, termId: t2526!.id, bodyId: old.bodyBy.ecb!, ownerId: U("ecb1") });
  const constitution = await textFile("Constitution.txt", "Constitution of AIESEC in Bangladesh (demo).", "ecb1");
  await db.insert(s.documents).values({ title: "Constitution of AIESEC in Bangladesh", category: "constitution", classification: "internal", fileId: constitution, termId: t2526!.id, bodyId: old.bodyBy.entity!, ownerId: U("ecb1") });

  // Old tracker rows (will be frozen when the term closes).
  const [oldOgxTracker] = await db.select().from(s.trackers).where(eq(s.trackers.bodyId, old.bodyBy["lc-dhaka-south-OGX"]!));
  for (const [name, country, stage] of [["Tanha", "Indonesia", "Finished"], ["Rifat", "Turkey", "Realised"], ["Mou", "Egypt", "Approved"], ["Shuvo", "Malaysia", "Lost"]] as const) {
    await db.insert(s.trackerRows).values({ trackerId: oldOgxTracker!.id, data: { name, product: "Global Volunteer", country, stage, owner: U("lcvp_ogx") }, createdById: U("lcvp_ogx") });
  }
  await db.insert(s.cases).values([
    {
      kind: "good_case", title: "University partnership desk doubled oGX applications", termId: t2526!.id, bodyId: old.bodyBy["lc-dhaka-south-OGX"], departmentKey: "OGX", authorId: U("nadia"),
      context: "Applications in Dhaka South had plateaued at ~20/month with most leads coming from social media.",
      approach: "Signed MoUs with 3 university career offices, ran a weekly info desk on campus and booked 1:1 calls on the spot.",
      outcome: "Applications rose from 20 to 43/month in 8 weeks; approval conversion stayed at ~30%.", recommendations: "Start desks in week 2 of the semester; train desk staff on objection handling first.",
      metrics: "Applications/month 20 → 43", tags: ["oGX", "university", "partnerships"],
    },
    {
      kind: "lesson", title: "Why our spring recruitment campaign under-delivered", termId: t2526!.id, bodyId: old.bodyBy["mc-MX"], departmentKey: "MX", authorId: U("maliha"),
      context: "National recruitment target was 300 members; we recruited 170.", approach: "One national campaign with identical messaging for all LCs.",
      outcome: "Low conversion in smaller LCs; interview capacity was the bottleneck.", rootCause: "No LC-level capacity planning; interviews depended on 2–3 people per LC.",
      recommendations: "Plan interviewer capacity per LC; localise messaging; track funnel daily during the campaign.", tags: ["recruitment", "MX"],
    },
  ]);
  await db.insert(s.decisions).values({
    code: "MC-2526-014", title: "Adopt a single national reporting rhythm (weekly, Monday)", termId: t2526!.id, bodyId: old.bodyBy.mc!, decidedById: U("alumna"),
    responsibleId: U("rafi"), status: "done", decidedOn: "2025-09-14", description: "All LCs report weekly KPIs by Monday 23:59 through the portal trackers.",
  });

  // ── 26.27 (current term) ──
  const cur = await buildTerm(t2627!.id, "26.27", {
    mcp: "firoz", ...Object.fromEntries(Object.entries(mcvps).map(([k, h]) => [`mcvp-${k}`, h])),
    "lcp-dhaka-south": "lcp_ds", "lcp-dhaka-north": "lcp_dn", "lcp-chittagong": "lcp_ctg", "lcp-sylhet": "lcp_syl",
    ...Object.fromEntries(Object.entries(dsLcvps).map(([k, [h]]) => [`lcvp-dhaka-south-${k}`, h])),
    "lcvp-dhaka-north-OGX": "lcvp_ogx_dn", "lcvp-chittagong-OGX": "lcvp_ogx_ctg",
    "tl-dhaka-south-OGX": "tl_ogx1", "member-dhaka-south-OGX": ["karim", "sumaiya", "rakib", "joya"],
    "tl-dhaka-south-MKT": "tl_mkt1", "member-dhaka-south-MKT": ["ovi", "priya"],
    "member-dhaka-north-OGX": ["nabil"], "member-chittagong-OGX": ["lamia"],
    "ecb-chair": "ecb1", "ecb-member": ["ecb2"], "esc-chair": "esc1", "efb-chair": "efb1", est: ["est1", "est2"],
  });

  // Close 25.26 (freezes its trackers, ends assignments) and activate 26.27.
  const { closeTerm } = await import("../lib/provision");
  await closeTerm(t2526!.id, U("firoz"));
  await db.update(s.terms).set({ status: "active" }).where(eq(s.terms.id, t2627!.id));
  await db.update(s.users).set({ status: "active" }).where(eq(s.users.status, "alumni"));
  await db.update(s.users).set({ status: "alumni" }).where(eq(s.users.id, U("alumna")));

  // OC, project and synergy team in 26.27
  const oc = await createBody({ termId: t2627!.id, type: "oc", name: "National Leadership Development Seminar 2026 — OC", shortName: "NLDS 2026 OC", parentId: cur.bodyBy.mc, lineageKey: "oc-nlds", startsOn: "2026-09-01", endsOn: "2026-12-20" });
  const ocp = await createPosition({ bodyId: oc.id, title: "OCP", roleKey: "ocp", isLeader: true, reportsToId: cur.posBy.mcp, sortOrder: 20 });
  const ocvpL = await createPosition({ bodyId: oc.id, title: "OCVP Logistics", roleKey: "ocvp", reportsToId: ocp.id, sortOrder: 21 });
  const ocvpDx = await createPosition({ bodyId: oc.id, title: "OCVP Delegate Experience", roleKey: "ocvp", reportsToId: ocp.id, sortOrder: 21 });
  const ocm = await createPosition({ bodyId: oc.id, title: "OC Member", roleKey: "oc_member", reportsToId: ocp.id, multiHolder: true, sortOrder: 22 });
  for (const [pid, h] of [[ocp.id, "ocp"], [ocvpL.id, "rakib"], [ocvpDx.id, "lamia"], [ocm.id, "ovi"], [ocm.id, "nabil"]] as const) {
    await db.insert(s.assignments).values({ userId: U(h), positionId: pid, termId: t2627!.id, active: true });
  }
  const proj = await createBody({ termId: t2627!.id, type: "project", name: "University Global Opportunities Desk", shortName: "UGOD", parentId: cur.bodyBy["mc-OGX"], lineageKey: "proj-ugod", startsOn: "2026-08-01", endsOn: "2027-03-31", description: "Pilot global-opportunity desks in 5 universities." });
  const pl = await createPosition({ bodyId: proj.id, title: "Project Lead", roleKey: "project_lead", isLeader: true, reportsToId: cur.posBy["mcvp-OGX"], sortOrder: 30 });
  const pm = await createPosition({ bodyId: proj.id, title: "Project Member", roleKey: "project_member", reportsToId: pl.id, multiHolder: true, sortOrder: 31 });
  await db.insert(s.assignments).values([
    { userId: U("lcvp_ogx"), positionId: pl.id, termId: t2627!.id, active: true },
    { userId: U("sumaiya"), positionId: pm.id, termId: t2627!.id, active: true },
  ]);
  const syn = await createBody({ termId: t2627!.id, type: "synergy", name: "oGX × MKT Campaign Synergy — Dhaka South", shortName: "oGX×MKT Synergy", parentId: cur.bodyBy["lc-dhaka-south"], lineageKey: "syn-ds-ogx-mkt" });
  await db.insert(s.bodyLinks).values([{ bodyId: syn.id, linkedBodyId: cur.bodyBy["lc-dhaka-south-OGX"]! }, { bodyId: syn.id, linkedBodyId: cur.bodyBy["lc-dhaka-south-MKT"]! }]);
  const sl = await createPosition({ bodyId: syn.id, title: "Synergy Lead", roleKey: "synergy_lead", isLeader: true, reportsToId: cur.posBy["lcvp-dhaka-south-MKT"], sortOrder: 40 });
  const sm = await createPosition({ bodyId: syn.id, title: "Synergy Member", roleKey: "synergy_member", reportsToId: sl.id, multiHolder: true, sortOrder: 41 });
  await db.insert(s.assignments).values([
    { userId: U("tl_mkt1"), positionId: sl.id, termId: t2627!.id, active: true },
    { userId: U("joya"), positionId: sm.id, termId: t2627!.id, active: true },
    { userId: U("priya"), positionId: sm.id, termId: t2627!.id, active: true },
  ]);

  // Current tracker data
  const trackerOf = async (bodyKey: string) => (await db.select().from(s.trackers).where(eq(s.trackers.bodyId, cur.bodyBy[bodyKey]!)))[0]!;
  const ogxDs = await trackerOf("lc-dhaka-south-OGX");
  const eps: [string, string, string, string][] = [
    ["Arpita", "Indonesia", "Approved", "karim"], ["Rahat", "Egypt", "Applied", "sumaiya"], ["Nafis", "Turkey", "Realised", "karim"], ["Ishrat", "Malaysia", "Accepted", "rakib"],
    ["Tasin", "Vietnam", "Lead", "joya"], ["Mim", "Sri Lanka", "Applied", "joya"], ["Adnan", "Indonesia", "Approved", "rakib"], ["Raisa", "Brazil", "Lead", "sumaiya"],
  ];
  for (const [name, country, stage, owner] of eps) {
    await db.insert(s.trackerRows).values({ trackerId: ogxDs.id, data: { name, product: "Global Volunteer", country, stage, owner: U(owner), next_follow_up: addDays(today, Math.floor(Math.random() * 7)) }, ownerId: U(owner), createdById: U(owner) });
  }
  const ogxTeam = await trackerOf("team-dhaka-south-OGX");
  for (const [name, stage, owner] of [["Tanzim", "Applied", "karim"], ["Ritu", "Approved", "sumaiya"]] as const) {
    await db.insert(s.trackerRows).values({ trackerId: ogxTeam.id, data: { name, product: "Global Talent", country: "Germany", stage, owner: U(owner) }, ownerId: U(owner), createdById: U(owner) });
  }
  const bdDs = await trackerOf("lc-dhaka-south-BD");
  for (const [org, stage, value] of [["Demo Telecom Ltd", "Negotiation", 250000], ["City Bank (demo)", "Won", 120000], ["EduTech BD (demo)", "Meeting", 80000], ["Green Foods (demo)", "Won", 60000]] as const) {
    await db.insert(s.trackerRows).values({ trackerId: bdDs.id, data: { organization: org, stage, value, owner: U("lcvp_bd"), type: "Financial" }, ownerId: U("lcvp_bd"), createdById: U("lcvp_bd") });
  }
  const ogxDn = await trackerOf("lc-dhaka-north-OGX");
  for (const [name, stage] of [["Sajid", "Applied"], ["Afsana", "Approved"], ["Bristy", "Approved"], ["Omar", "Realised"], ["Tuli", "Applied"]] as const) {
    await db.insert(s.trackerRows).values({ trackerId: ogxDn.id, data: { name, stage, product: "Global Volunteer", owner: U("lcvp_ogx_dn") }, createdById: U("lcvp_ogx_dn") });
  }
  const ogxCtg = await trackerOf("lc-chittagong-OGX");
  await db.insert(s.trackerRows).values({ trackerId: ogxCtg.id, data: { name: "Fahad", stage: "Lead", product: "Global Volunteer", owner: U("lcvp_ogx_ctg") }, createdById: U("lcvp_ogx_ctg") });
  const fnlMc = await trackerOf("mc-FNL");
  for (const [date, item, type, amount, status] of [["2026-08-05", "Partner sponsorship — Demo Telecom", "Income", 300000, "Received"], ["2026-08-20", "NLDS venue deposit", "Expense", 120000, "Paid"], ["2026-09-10", "Exchange fees (Aug)", "Income", 210000, "Received"], ["2026-10-01", "Sponsorship instalment 2", "Receivable", 150000, "Overdue"]] as const) {
    await db.insert(s.trackerRows).values({ trackerId: fnlMc.id, data: { date, item, type, amount, status }, createdById: U("arif") });
  }
  const risk = await trackerOf("mc");
  for (const [r, p, i, m] of [["Low recruitment in smaller LCs", "High", "High", "LC capacity planning + national support"], ["Sponsorship receivable overdue", "Medium", "Critical", "FNL follow-up plan, escalate to partner exec"], ["oGX approval conversion falling", "Medium", "High", "Weekly funnel reviews with LCVPs"]] as const) {
    await db.insert(s.trackerRows).values({ trackerId: risk.id, data: { risk: r, probability: p, impact: i, mitigation: m, owner: U("firoz"), status: "Open" }, createdById: U("firoz") });
  }
  const ocT = (await db.select().from(s.trackers).where(eq(s.trackers.bodyId, oc.id)))[0]!;
  for (const [item, fn, status, budget, owner] of [["Venue contract", "Logistics", "Done", 250000, "rakib"], ["Delegate registration form", "Delegate experience", "In progress", 0, "lamia"], ["Session speakers", "Programme", "Not started", 30000, "ocp"]] as const) {
    await db.insert(s.trackerRows).values({ trackerId: ocT.id, data: { item, function: fn, status, budget, owner: U(owner), due: addDays(today, 10) }, createdById: U("ocp") });
  }
  const synT = (await db.select().from(s.trackers).where(eq(s.trackers.bodyId, syn.id)))[0]!;
  await db.insert(s.trackerRows).values({ trackerId: synT.id, data: { goal: "Campus GV campaign — 200 leads", side: "MKT creates content, oGX converts", status: "In progress", result: 86, owner: U("tl_mkt1") }, createdById: U("tl_mkt1") });

  // Individual KPI
  await db.insert(s.kpis).values([
    { bodyId: cur.bodyBy["team-dhaka-south-OGX"]!, termId: t2627!.id, userId: U("karim"), name: "Applications (Karim)", target: 10, source: "manual", departmentKey: "OGX", metricKey: "ogx.applications.individual" },
    { bodyId: cur.bodyBy.mc!, termId: t2627!.id, name: "Members recruited (national)", target: 300, source: "manual", departmentKey: "MX", metricKey: "mx.recruited" },
  ]);
  const [karimKpi] = await db.select().from(s.kpis).where(eq(s.kpis.userId, U("karim")));
  await db.insert(s.kpiEntries).values({ kpiId: karimKpi!.id, value: 6, occurredOn: today, source: "manual", createdById: U("karim") });

  // Tasks (hierarchical)
  type T = Omit<typeof s.tasks.$inferInsert, "termId">;
  const tasks: T[] = [
    { title: "Submit weekly LC oGX pipeline report", createdById: U("nadia"), assigneeId: U("lcvp_ogx"), bodyId: cur.bodyBy["lc-dhaka-south-OGX"], priority: "high", status: "in_progress", dueAt: daysFromNow(2), requireAck: true, acknowledgedAt: new Date(), category: "report" },
    { title: "University mapping — top 10 campuses", createdById: U("nadia"), assigneeId: U("lcvp_ogx_dn"), bodyId: cur.bodyBy["lc-dhaka-north-OGX"], priority: "medium", status: "completed", dueAt: daysFromNow(-1), completedAt: new Date() },
    { title: "Weekly LC report", createdById: U("nadia"), assigneeId: U("lcvp_ogx_ctg"), bodyId: cur.bodyBy["lc-chittagong-OGX"], priority: "high", status: "not_started", dueAt: daysFromNow(-3), escalationLevel: 0 },
    { title: "Call 20 university leads", description: "Use the call script in the oGX playbook.", createdById: U("lcvp_ogx"), assigneeId: U("tl_ogx1"), bodyId: cur.bodyBy["team-dhaka-south-OGX"], priority: "medium", status: "in_progress", dueAt: daysFromNow(1) },
    { title: "Follow up 5 applicants this week", createdById: U("tl_ogx1"), assigneeId: U("karim"), bodyId: cur.bodyBy["team-dhaka-south-OGX"], priority: "medium", status: "not_started", dueAt: daysFromNow(-2), kpiId: karimKpi!.id, kpiContribution: 5 },
    { title: "Prepare info-session slides", createdById: U("tl_ogx1"), assigneeId: U("sumaiya"), bodyId: cur.bodyBy["team-dhaka-south-OGX"], priority: "low", status: "blocked", blockedCategory: "Waiting for another person", blockedReason: "Need brand assets from MKT", dueAt: daysFromNow(3) },
    { title: "Lock NLDS venue contract", createdById: U("ocp"), assigneeId: U("rakib"), bodyId: oc.id, priority: "critical", status: "submitted", dueAt: daysFromNow(0, 22), submittedAt: new Date() },
    { title: "Send sponsorship instalment reminder to Demo Telecom", createdById: U("arif"), assigneeId: U("lcvp_fnl"), bodyId: cur.bodyBy["lc-dhaka-south-FNL"], priority: "high", status: "not_started", dueAt: daysFromNow(1) },
    { title: "Q2 national strategy review deck", createdById: U("firoz"), assigneeId: U("rafi"), bodyId: cur.bodyBy["mc-IM"], priority: "high", status: "in_progress", dueAt: daysFromNow(5), requireAck: true },
  ];
  for (const t of tasks) {
    const [row] = await db.insert(s.tasks).values({ ...t, termId: t2627!.id }).returning();
    await db.insert(s.taskEvents).values({ taskId: row!.id, actorId: t.createdById, type: "created", message: "Task assigned" });
  }
  await db.insert(s.recurringTasks).values([
    { title: "Weekly LC report", createdById: U("firoz"), positionId: cur.posBy["lcp-dhaka-south"]!, cadence: "weekly", weekday: 1, priority: "high" },
    { title: "Weekly team report", createdById: U("lcvp_ogx"), positionId: cur.posBy["tl-dhaka-south-OGX"]!, cadence: "weekly", weekday: 0, priority: "medium" },
    { title: "Daily pipeline update", createdById: U("firoz"), positionId: cur.posBy["mcvp-OGX"]!, cadence: "daily", priority: "medium", dueHour: 22 },
  ]);

  // Daily updates & attendance for the last 5 days (Karim misses some — the reporting view shows it)
  for (let i = 1; i <= 5; i++) {
    const d = addDays(today, -i);
    for (const h of ["sumaiya", "rakib", "tl_ogx1", "lcvp_ogx", "joya"]) {
      await db.insert(s.dailyUpdates).values({ userId: U(h), date: d, accomplished: "Followed up applicants and updated the tracker.", workingOn: "University leads", tomorrow: "Info session prep", metrics: { calls: 6 + i, leads: 2, follow_ups: 4 } }).onConflictDoNothing();
      await db.insert(s.attendance).values({ userId: U(h), date: d, checkInAt: new Date(`${d}T03:30:00Z`), checkOutAt: new Date(`${d}T11:00:00Z`) });
    }
  }

  await db.insert(s.announcements).values([
    { title: "MCVP application deadline extended to 20 October", body: "Applications for the remaining MCVP role close 20 October, 23:59. Please share with eligible members.", authorId: U("firoz"), audience: "national", priority: "critical", requireAck: true },
    { title: "National education: Sales fundamentals — Thursday 7 PM", body: "All oGX and BD members are expected to attend. Link in the calendar.", authorId: U("maliha"), audience: "national", priority: "important" },
    { title: "Dhaka South: LC meeting moved to Saturday", body: "Same venue, 4 PM.", authorId: U("lcp_ds"), audience: "body", bodyId: cur.bodyBy["lc-dhaka-south"], priority: "normal" },
  ]);
  await db.insert(s.events).values([
    { title: "National education: Sales fundamentals", kind: "education", startsAt: daysFromNow(3, 19), endsAt: daysFromNow(3, 21), venue: "Online", bodyId: cur.bodyBy.mc, audience: "national", createdById: U("maliha"), checkinCode: randomToken(12) },
    { title: "Dhaka South LC meeting", kind: "meeting", startsAt: daysFromNow(5, 16), venue: "DU TSC", bodyId: cur.bodyBy["lc-dhaka-south"], audience: "body", createdById: U("lcp_ds"), checkinCode: randomToken(12) },
    { title: "NLDS 2026", kind: "conference", startsAt: daysFromNow(40, 9), endsAt: daysFromNow(42, 18), venue: "Gazipur", bodyId: oc.id, audience: "national", createdById: U("ocp"), checkinCode: randomToken(12) },
    { title: "MC meeting — monthly review", kind: "meeting", startsAt: daysFromNow(1, 20), venue: "Online", bodyId: cur.bodyBy.mc, audience: "body", createdById: U("firoz"), checkinCode: randomToken(12) },
  ]);
  await db.insert(s.recognitions).values([
    { fromId: U("lcvp_ogx"), toId: U("sumaiya"), message: "Ran the whole info session solo when the speaker cancelled. Thank you!", badge: "Team Player" },
    { fromId: U("firoz"), toId: U("lcvp_bd"), message: "Closed two partnerships in one week. Huge.", badge: "Growth Champion" },
    { fromId: U("tl_ogx1"), toId: U("rakib"), message: "Daily updates every single day this month.", badge: "Consistency King" },
  ]);
  const [idea] = await db.insert(s.ideas).values({ title: "University Global Opportunities Desk", problem: "Students don't know AIESEC exchange exists until their final year.", idea: "Permanent desks in career offices staffed weekly by LC members.", impact: "+30% applications in pilot LCs", authorId: U("nadia"), departmentKey: "OGX", status: "pilot" }).returning();
  for (const h of ["karim", "sumaiya", "rakib", "tl_ogx1", "lcp_ds"]) await db.insert(s.ideaVotes).values({ ideaId: idea!.id, userId: U(h) });
  await db.insert(s.ideas).values({ title: "Alumni mentor hour", problem: "New TLs struggle in their first month.", idea: "Monthly open mentor hour with alumni leaders.", authorId: U("tl_mkt1"), departmentKey: "MX" });
  await db.insert(s.posts).values([
    { authorId: U("lcp_ds"), body: "Congratulations to oGX Dhaka South for 3 approvals this week! 🎉", kind: "achievement", audience: "national" },
    { authorId: U("shristi"), body: "New brand kit for 26.27 is in the Documents hub under MC MKT.", kind: "knowledge", audience: "national" },
  ]);
  await db.insert(s.motions).values({ code: "ECB-2627-001", title: "Approve election timeline for MCVP by-election", termId: t2627!.id, bodyId: cur.bodyBy.ecb!, quorum: 2, closesAt: daysFromNow(4), createdById: U("ecb1") });
  await db.insert(s.decisions).values({ code: "MC-2627-003", title: "Pilot University Global Opportunities Desk in 5 universities", termId: t2627!.id, bodyId: cur.bodyBy.mc!, decidedById: U("firoz"), responsibleId: U("nadia"), deadline: "2027-03-31", status: "in_progress", decidedOn: "2026-08-10" });

  // Templates (versioned)
  await db.insert(s.templates).values([
    { kind: "offer_letter", name: "Standard offer letter", version: 1, body: OFFER_TEMPLATE },
    { kind: "nda", name: "Standard NDA", version: 1, body: NDA_TEMPLATE },
    { kind: "email_offer", name: "Offer email", version: 1, subject: "🎉 Congratulations — Your AIESEC Bangladesh Offer Letter", body: "Dear {{candidate_name}},\n\nCongratulations! You have been selected as **{{position}}** in **{{department}}**, {{lc_name}}, for term {{term}}.\n\nPlease review and respond to your offer before **{{offer_expiry_date}}**.\n\nThis offer is personal and confidential. Do not share the link." },
    { kind: "email_offer_reminder", name: "Offer reminder", version: 1, subject: "Reminder — Your AIESEC Bangladesh offer letter is waiting", body: "Dear {{candidate_name}},\n\nYour offer for **{{position}}** is still waiting for your response. It expires on **{{offer_expiry_date}}**." },
    { kind: "email_activation", name: "Account activation", version: 1, subject: "🔐 Your AIESEC Bangladesh Portal account is ready", body: "Dear {{candidate_name}},\n\nYour portal account has been created. Username: **{{name}}**\n\nUse the button below to set your password. The link works once and expires in 72 hours. We will never ask for your password by email." },
    { kind: "email_welcome", name: "Welcome", version: 1, subject: "Welcome to AIESEC in Bangladesh", body: "Dear {{candidate_name}},\n\nWelcome aboard as {{position}}! Your onboarding journey starts in the portal." },
    { kind: "email_onboarding_complete", name: "Onboarding complete", version: 1, subject: "🎉 Onboarding completed", body: "Dear {{candidate_name}},\n\nYou have completed onboarding. Welcome to the team!" },
  ]);

  // Recruitment pipeline sample
  await db.insert(s.candidates).values([
    { fullName: "Tahsin Ahmed", email: "tahsin@example.org", termId: t2627!.id, positionId: cur.posBy["member-dhaka-south-OGX"], reportingUserId: U("tl_ogx1"), startDate: addDays(today, 7), offerExpiresOn: addDays(today, 5), status: "selected", selectedAt: new Date(), createdById: U("maliha") },
    { fullName: "Mahira Chowdhury", email: "mahira@example.org", termId: t2627!.id, positionId: cur.posBy["member-dhaka-south-MKT"], reportingUserId: U("tl_mkt1"), status: "interviewed", createdById: U("maliha") },
    { fullName: "Saif Hossain", email: "saif@example.org", termId: t2627!.id, positionId: cur.posBy["member-dhaka-south-OGX"], status: "applied", createdById: U("maliha") },
  ]);

  console.log(`Seeded. Sign in with e.g. firoz@example.org / ${DEMO_PASSWORD}`);
  await sql.end();
}

const OFFER_TEMPLATE = `# Offer of Position — {{position}}

Offer ID: **{{offer_id}}**

Dear {{candidate_name}},

On behalf of AIESEC in Bangladesh, we are delighted to offer you the position of **{{position}}** in **{{department}}**, {{lc_name}}, for term **{{term}}**.

## Details
- Position: {{position}}
- Department: {{department}}
- Local committee: {{lc_name}}
- Term: {{term}}
- Start date: {{start_date}}
- Reporting to: {{reporting_manager}}

## What we expect
- Live the AIESEC values and the code of conduct
- Complete onboarding, including AIESEC 101, within the first two weeks
- Report weekly through the national portal

This offer is valid until **{{offer_expiry_date}}**. It is personal and confidential.

With warm regards,
AIESEC in Bangladesh`;

const NDA_TEMPLATE = `# Non-Disclosure Agreement

This agreement is between AIESEC in Bangladesh ("the Entity") and {{candidate_name}} ("the Member"), joining as {{position}} for term {{term}}.

## 1. Confidential information
Confidential information includes member personal data, partner and financial information, internal strategy, performance records and anything marked confidential in the portal.

## 2. Obligations
- Use confidential information only for AIESEC work
- Do not share it outside the people who need it for their role
- Do not export, copy or forward data except through approved processes
- Return or delete confidential material when your position ends

## 3. Duration
These obligations continue for two years after your position ends.

By signing, the Member confirms they have read, understood and agree to this agreement.`;

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
