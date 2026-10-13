// End-to-end: TL assigns a KPI-linked task with acknowledgement → member acknowledges, blocks, submits →
// TL approves → KPI credited. Then tracker permissions: member adds a row, MC member can read but not write.
// Requires the dev server and a freshly seeded database. Usage: node tests/e2e-work.mjs
import { chromium } from "playwright";
import postgres from "postgres";

const BASE = process.argv[2] ?? "http://localhost:3000";
const sql = postgres(process.env.DATABASE_URL ?? "postgres://abg:abg@localhost:5432/abg_portal");
const step = (m) => console.log(`✔ ${m}`);
const fail = async (m) => { console.error(`✘ ${m}`); await sql.end(); process.exit(1); };

const browser = await chromium.launch();
async function login(handle) {
  const p = await (await browser.newContext()).newPage();
  await p.goto(`${BASE}/login`);
  await p.fill('input[name="email"]', `${handle}@example.org`);
  await p.fill('input[name="password"]', "Portal#2026demo");
  await Promise.all([p.waitForURL("**/dashboard", { timeout: 60000 }), p.click('button[type="submit"]')]);
  return p;
}
const op = (page, label) => page.getByRole("button", { name: label }).first().click();

try {
  const [karim] = await sql`select id from users where email = 'karim@example.org'`;
  const [kpi] = await sql`select id from kpis where name = 'Applications (Karim)'`;
  const before = Number((await sql`select coalesce(sum(value),0) as v from kpi_entries where kpi_id = ${kpi.id}`)[0].v);

  // TL assigns
  const tl = await login("tl_ogx1");
  await tl.goto(`${BASE}/tasks/new?assignee=${karim.id}`, { timeout: 120000 });
  await tl.fill('input[name="title"]', "E2E: call 4 university leads");
  await tl.selectOption('select[name="kpiId"]', kpi.id);
  await tl.fill('input[name="kpiContribution"]', "4");
  await tl.check('input[name="requireAck"]');
  await Promise.all([tl.waitForURL(/\/tasks\/[0-9a-f-]{36}$/, { timeout: 60000 }), op(tl, "Assign task")]);
  const taskUrl = tl.url();
  step("TL assigned a KPI-linked task requiring acknowledgement");

  // Member
  const m = await login("karim");
  const [n] = await sql`select title from notifications where user_id = ${karim.id} and title like '%E2E: call 4%'`;
  if (!n) await fail("assignee not notified");
  await m.goto(taskUrl, { timeout: 120000 });
  await op(m, "I acknowledge this task");
  await m.getByText(/acknowledged the task/).waitFor();
  await op(m, "▶ Start task");
  await m.getByText(/started the task/).waitFor();
  await m.selectOption('select[name="category"]', "Waiting for partner");
  await op(m, "Mark blocked");
  await m.getByText(/marked the task BLOCKED/).first().waitFor();
  const [blockN] = await sql`select n.title from notifications n join users u on u.id = n.user_id where u.email = 'tl_ogx1@example.org' and n.title like '%BLOCKED%'`;
  if (!blockN) await fail("assigner not told about the block");
  step("member acknowledged, started, marked blocked → TL notified");
  await op(m, "Unblock & continue");
  await m.getByText(/Submit for review/).waitFor();
  await op(m, "📤 Submit for review");
  await m.getByText(/submitted the task for review/).waitFor();
  step("member submitted for review");

  // A peer cannot see the task
  const peer = await login("sumaiya");
  const res = await peer.goto(taskUrl);
  if (res?.status() !== 404) await fail(`peer should get 404, got ${res?.status()}`);
  step("a peer cannot open the task (404)");

  // TL approves → KPI credited
  await tl.goto(taskUrl);
  await op(tl, "✓ Approve & complete");
  await tl.getByText(/reviewed and marked the task Completed/).waitFor();
  const after = Number((await sql`select coalesce(sum(value),0) as v from kpi_entries where kpi_id = ${kpi.id}`)[0].v);
  if (after - before !== 4) await fail(`KPI should increase by 4, got ${after - before}`);
  step("TL approved → KPI automatically credited +4");

  // Trackers: member adds a row; MC can read but not write; other LC's LCVP cannot see
  const [tr] = await sql`select t.id from trackers t join bodies b on b.id = t.body_id join terms tm on tm.id = t.term_id where b.name = 'oGX Team 1 — Dhaka South' and tm.code = '26.27'`;
  await m.goto(`${BASE}/trackers/${tr.id}`, { timeout: 120000 });
  await m.fill('input[name="c_name"]', "E2E Applicant");
  await m.selectOption('select[name="c_stage"]', "Applied");
  await op(m, "Add row");
  await m.getByText("Row added.").waitFor();
  step("member added a tracker row");
  const mc = await login("arif");
  await mc.goto(`${BASE}/trackers/${tr.id}`, { timeout: 120000 });
  await mc.getByText("E2E Applicant").waitFor();
  if (await mc.getByRole("button", { name: "Add row" }).count()) await fail("MC member should not get the add-row form");
  step("MCVP FNL (MC) can read the team tracker but not edit it");
  const other = await login("lcvp_ogx_dn");
  const r2 = await other.goto(`${BASE}/trackers/${tr.id}`);
  if (r2?.status() !== 404) await fail(`other LC's LCVP should get 404, got ${r2?.status()}`);
  step("another LC's LCVP cannot see it (404)");
  console.log("\nTasks, KPIs & trackers flow: PASS");
} finally {
  await browser.close();
  await sql.end();
}
