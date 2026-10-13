// End-to-end: recruiter sends an offer → candidate accepts via the emailed link → signs NDA →
// activates account from the activation email → completes the welcome step → sees onboarding.
// Requires the dev server and a freshly seeded database. Usage: node tests/e2e-recruitment.mjs
import { chromium } from "playwright";
import postgres from "postgres";

const BASE = process.argv[2] ?? "http://localhost:3000";
const sql = postgres(process.env.DATABASE_URL ?? "postgres://abg:abg@localhost:5432/abg_portal");
const step = (m) => console.log(`✔ ${m}`);
const fail = async (m) => { console.error(`✘ ${m}`); await sql.end(); process.exit(1); };

const browser = await chromium.launch();
try {
  // 1. Recruiter (MX/recruitment admin) generates and sends the offer
  const rec = await browser.newPage();
  await rec.goto(`${BASE}/login`);
  await rec.fill('input[name="email"]', "maliha@example.org");
  await rec.fill('input[name="password"]', "Portal#2026demo");
  await Promise.all([rec.waitForURL("**/dashboard", { timeout: 60000 }), rec.click('button[type="submit"]')]);
  const [cand] = await sql`select id from candidates where email = 'tahsin@example.org'`;
  await rec.goto(`${BASE}/recruitment/${cand.id}`, { timeout: 120000 });
  await rec.getByRole("button", { name: /Generate & send offer/ }).click();
  await rec.getByText(/generated and emailed/).waitFor({ timeout: 30000 });
  step("offer generated and emailed");

  const [mail] = await sql`select html from email_outbox where "to" = 'tahsin@example.org' order by created_at desc limit 1`;
  const offerUrl = mail.html.match(/href="([^"]*\/offer\/[^"]+)"/)?.[1];
  if (!offerUrl) await fail("offer link not found in email");
  const [o] = await sql`select token_hash from offers where candidate_id = ${cand.id} order by created_at desc limit 1`;
  if (offerUrl.includes(o.token_hash)) await fail("raw token must not equal stored hash");
  step("email contains a secure link; only its hash is stored");

  // 2. Candidate (no account) opens the link, accepts
  const c = await (await browser.newContext()).newPage();
  await c.goto(offerUrl.replace(/^https?:\/\/[^/]+/, BASE), { timeout: 120000 });
  await c.getByRole("heading", { name: /Congratulations, Tahsin/ }).waitFor();
  await c.fill('input[name="email"] >> nth=0', "wrong@example.org");
  await c.check('input[name="confirm"]');
  await c.getByRole("button", { name: "ACCEPT OFFER" }).click();
  await c.getByText("doesn't match").waitFor();
  step("acceptance refused with the wrong email");
  await c.fill('input[name="email"] >> nth=0', "tahsin@example.org");
  await Promise.all([c.waitForURL("**/nda", { timeout: 60000 }), c.getByRole("button", { name: "ACCEPT OFFER" }).click()]);
  step("offer accepted → NDA");

  // 3. NDA
  await c.check('input[name="confirm"]');
  await c.fill('input[name="signedName"]', "Tahsin Ahmed");
  await c.getByRole("button", { name: "SIGN & CONTINUE" }).click();
  await c.getByRole("heading", { name: /NDA signed/ }).waitFor({ timeout: 60000 });
  const [cs] = await sql`select status, user_id from candidates where id = ${cand.id}`;
  if (cs.status !== "account_created" || !cs.user_id) await fail(`expected account_created, got ${cs.status}`);
  const items = await sql`select key, task_id from onboarding_items where user_id = ${cs.user_id}`;
  if (items.length < 10 || !items.some((i) => i.task_id)) await fail("onboarding checklist/tasks not created");
  step(`NDA signed → account created with ${items.length} onboarding items and auto tasks`);

  // 4. Replay protection: the offer link no longer accepts
  await c.goto(offerUrl.replace(/^https?:\/\/[^/]+/, BASE));
  if (await c.getByRole("button", { name: "ACCEPT OFFER" }).count()) await fail("offer still acceptable after acceptance");
  step("offer link cannot be replayed");

  // 5. Activation email → set password → welcome → onboarding
  const [act] = await sql`select html from email_outbox where "to" = 'tahsin@example.org' and subject like '%account is ready%' order by created_at desc limit 1`;
  const actUrl = act?.html.match(/href="([^"]*\/activate\/[^"]+)"/)?.[1];
  if (!actUrl) await fail("activation link not found");
  await c.goto(actUrl.replace(/^https?:\/\/[^/]+/, BASE), { timeout: 120000 });
  await c.fill('input[name="password"]', "NewMember#2026x");
  await c.fill('input[name="confirm"]', "NewMember#2026x");
  await Promise.all([c.waitForURL("**/welcome", { timeout: 60000 }), c.getByRole("button", { name: "Save password" }).click()]);
  await c.getByRole("heading", { name: /Welcome to AIESEC in Bangladesh/ }).waitFor();
  step("account activated, first-login welcome shown");
  await c.fill('input[name="phone"]', "+8801700000000");
  await c.fill('input[name="university"]', "BUET");
  await c.check('input[name="terms"]');
  await Promise.all([c.waitForURL("**/onboarding**", { timeout: 60000 }), c.getByRole("button", { name: "Continue to onboarding" }).click()]);
  await c.getByRole("heading", { name: "Your onboarding" }).waitFor();
  const pct = await c.getByText(/completed — \d+%/).first().innerText();
  step(`onboarding page reached (${pct})`);

  // 6. The activation link is single-use
  await c.goto(actUrl.replace(/^https?:\/\/[^/]+/, BASE));
  await c.getByRole("heading", { name: /Link expired/ }).waitFor();
  step("activation link is single-use");

  // 7. The new member appears in their team and their leader was notified
  const [notif] = await sql`select n.title from notifications n join users u on u.id = n.user_id where u.email = 'tl_ogx1@example.org' and n.title like '%Tahsin%'`;
  if (!notif) await fail("reporting leader not notified");
  step(`leader notified: "${notif.title}"`);
  console.log("\nRecruitment → onboarding flow: PASS");
} finally {
  await browser.close();
  await sql.end();
}
