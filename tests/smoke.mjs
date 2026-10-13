// End-to-end smoke test: signs in as different roles and opens every main page, failing on any
// server error or error overlay. Usage: node tests/smoke.mjs [baseUrl]
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3000";
const PASSWORD = "Portal#2026demo";
const PAGES = (process.env.PAGES ?? "/dashboard").split(",");
const USERS = (process.env.USERS ?? "firoz").split(",");

const browser = await chromium.launch();
let failures = 0;
for (const handle of USERS) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', `${handle}@example.org`);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click('button[type="submit"]')]);
  for (const p of PAGES) {
    const res = await page.goto(`${BASE}${p}`, { timeout: 120000 });
    const status = res?.status() ?? 0;
    const body = await page.content();
    const bad = status >= 500 || /Unhandled Runtime Error|Application error|Internal Server Error|digest:/.test(body);
    const finalPath = new URL(page.url()).pathname;
    console.log(`${bad ? "FAIL" : "ok  "} ${handle.padEnd(12)} ${p.padEnd(32)} ${status} → ${finalPath}`);
    if (bad) {
      failures++;
      const text = (await page.innerText("body").catch(() => "")).slice(0, 800);
      console.log(text);
    }
    if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/${handle}${p.replace(/\//g, "_")}.png`, fullPage: true });
  }
  if (errors.length) console.log("page errors:", errors.slice(0, 3));
  await ctx.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
