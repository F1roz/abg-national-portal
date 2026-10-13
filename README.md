# ABG National Portal — AIESEC in Bangladesh

A configurable **organisational operating system**. AIESEC in Bangladesh is the first implementation. The structure of the entity lives in **data** (terms, bodies, positions, reporting lines), not code, so it survives every new term. Another entity could run it by changing data only.

```
Term ─┬─ Body  (entity · mc · lc · department · team · governance · support · oc · project · synergy)
      │    └─ Position (role key, JD, reports_to another position, leader?)
      │          └─ Assignment (person holds a position for a period)
```

## What is built

| Area | What you get |
|---|---|
| **Identity & security** | Email + password (bcrypt), sessions stored hashed, idle + absolute expiry, IP rate limiting, account lockout, new-device alerts, login history, device/session management, **TOTP two-step verification (mandatory for leaders, MC, governance and admins)**, forced password change, single-use activation/reset links (passwords are never emailed). |
| **Access engine** (`src/lib/access.ts`) | RBAC + ABAC. Members see their own bodies; leaders see the subtree they lead; **the MC can read every standard tracker, KPI and document in the entity**; governance bodies (ECB/ESC/EFB) are confidential, so not even the MCP sees their work; archive access follows **lineage** (the next LCVP oGX of Dhaka South inherits the previous one's records); partners/BOA only see "external" material. 22 tests in `tests/access.test.ts`. |
| **Organisation** | Interactive structure tree, directory with filters, body spaces (LC / department / team / OC / project / synergy) with health score, people, KPIs, trackers, documents and open tasks. MC, LCs, departments, teams, EST, ECB/ESC/EFB, OCs (OCP/OCVPs), projects and synergy teams are all supported. |
| **Trackers for every team** | Every body gets a tracker automatically from a template for its department/type: oGX/iCX funnels, BD partner CRM, MKT campaigns, FNL ledger, MX engagement, IM log, OD, EwA, OC logistics, project milestones, synergy goals, compliance tracker, risk register. Leaders can add columns. Rows roll up into KPIs automatically. CSV export (audited). Leaders see their team's trackers; **the MC sees all of them**. |
| **KPIs** | Targets vs actuals. Actuals come from tracker roll-ups, KPI-linked tasks (completing "Call 20 universities" adds +20) and manual entries. National comparison across LCs, and the same metric in the previous term. |
| **Term archive** | Each term keeps its bodies, documents, numbers (as data), frozen tracker snapshots, decisions and cases. E.g. *25.26 → MC 25.26 → 7 departments → strategy, report, numbers, handover*. Closing a term freezes trackers, ends assignments and moves people without a new position to alumni. **Nothing is deleted.** A new term can be created by cloning the previous structure. |
| **Tasks** | Hierarchical assignment (anyone in your led subtree; the MC can assign to anyone), multi-assign, acknowledgement, start → blocked → submit → review → approve/rework, extension requests, reassign, deadline changes, comments, attachments, full activity timeline, "assigned by me" health, team view, KPI links, recurring tasks that follow the **position** (so they survive handovers). |
| **Automation engine** (`src/jobs/engine.ts`) | Deadline reminders (7d/3d/24h/3h), then the overdue ladder: assignee → assigner → supervisor → next level, framed as support rather than penalty. Also: daily-update nudges and patterns (skipping approved leave and weekends), offer reminders and expiry, incomplete-onboarding alerts, auto-closing of governance motions, MoU/contract expiry warnings, weekly personal summaries, and email delivery. Idempotent, with thresholds editable in Admin → Automation. |
| **Daily work** | Daily update with department-specific metrics, check-in/out, event QR check-in (no location tracking), team reporting view with "nudge" button. |
| **Dashboards** | Role-adaptive home ("what do I need to know and do today?"), leader blocks (team today, tasks I assigned, needs attention), **MC Command Center** (entity health, LC health, department × LC heatmap, national portfolio sums, finance, recruitment pipeline, strategic projects/OCs, what needs my attention, top contributors). |
| **Communication** | Announcements with audiences, priorities, expiry and required acknowledgement (with ack counts). Notification centre with priorities and per-type email preferences. Newsfeed with audience levels (national / body / leadership / external), reactions, comments and #tags. Calendar & events. |
| **Recruitment → onboarding** | Pipeline (applied → … → active). Versioned offer letter generated from a template with variables and a unique code (`AIESEC-BD-26-27-000001`). Branded email with a **secure single-person link** (only its SHA-256 is stored). Candidate verifies their email to accept/decline. Digital **NDA** with content hash, typed legal name, IP/UA. Then **automatic account creation** (least privilege, position assigned), activation email, role-based onboarding checklist with auto-created tasks, completion detection and notifications. |
| **People processes** | Leave with approval chain (approve/reject/forward up), recognition wall + badges, contribution leaderboard (performance + contribution + consistency + culture + learning, not revenue-only), 360° reviews (self/manager/peer; never visible to peers), handover checklists that transfer open tasks to the successor. |
| **Knowledge** | Documents hub (classification, versions, expiry, view-only, permission-checked downloads, audited), good cases and lessons learned with "How do I…" search, idea board with voting and workflow, global search across everything you're allowed to see. |
| **Governance** | Motions with eligible voters (holders of the governance body), quorum, final votes, recorded voters/timestamps, auto-tally at closing. Decision log with codes, responsible person, deadline and status. |
| **Administration** | Terms (create/clone/activate/close), structure (bodies, positions, reporting lines, assignments, **offboarding** that transfers tasks, revokes sessions and moves the person to alumni), users, system roles with a **two-person approval rule** (also required to change an MCP/MCVP and for bulk exports), versioned email/offer/NDA templates, email outbox, **hash-chained tamper-evident audit log** with verification, automation settings. |
| **External portal** | BOA: aggregated national KPIs and member/LC counts. Partners: external announcements, documents and events. No internal newsfeed, reviews, HR or individual data. |
| **PWA** | Installable (manifest + service worker; authenticated pages are never cached). |

### Not built yet (next phases)

These parts of the vision need decisions or external services first. They are intentionally left out rather than half-built:

- **Private 1:1 messaging.** It needs end-to-end encryption design and a policy for exceptional access. Members already use WhatsApp, so it is low priority.
- **Exchange integration with EXPA / AIESEC global systems.** The oGX/iCX trackers are manual today; numbers should be pulled through the API.
- **Finance ERP flows** (expense → approval → payment → reconciliation), procurement and inventory.
- **AI copilot / "Ask the portal"** (must respect the access engine), and automated narrative weekly reports.
- **Web Push and WhatsApp notifications** (portal + email work today), LMS (courses, quizzes, certificates), mentorship, surveys/pulse, succession and competency scoring, alumni network, partner self-service projects.

## Run it locally

Requirements: Node 22, PostgreSQL 16 (or `docker compose up -d`).

```bash
cp .env.example .env            # edit DATABASE_URL, APP_URL, CRON_SECRET
npm install
npm run db:push                 # create tables
npm run db:seed                 # demo data: 25.26 (archived) + 26.27 (active)
npm run dev                     # http://localhost:3000
```

**Demo accounts** (all fictional, password `Portal#2026demo`):

| Login | Role |
|---|---|
| `firoz@example.org` | MCP 26.27 (sees everything that isn't confidential) |
| `nadia@example.org` | MCVP oGX (MC: entity-wide read access) |
| `rafi@example.org` | MCVP IM, system admin |
| `maliha@example.org` | MCVP MX, MX + recruitment admin |
| `arif@example.org` | MCVP FNL, finance admin |
| `lcp_ds@example.org` | LCP Dhaka South |
| `lcvp_ogx@example.org` | LCVP oGX Dhaka South (also project lead) |
| `tl_ogx1@example.org` | TL oGX Team 1 |
| `karim@example.org` | Member, oGX Team 1 |
| `ecb1@example.org` | ECB chair, governance admin |
| `ocp@example.org` | OCP, National Leadership Development Seminar OC |
| `boa@example.org` | Board of Advisors (external portal) |

Leaders must set up two-step verification at first sign-in. For local exploration you can set `ENFORCE_LEADER_MFA=false` in `.env`. **Never do this in production.**

## Tests

```bash
npm run typecheck
npm test                            # access-engine rules against the seeded org
npm run test:e2e                    # browser flows (dev server running, freshly seeded DB):
                                    #   recruitment → offer → NDA → account → onboarding
                                    #   task assign → ack → block → submit → approve → KPI; tracker permissions
node tests/smoke.mjs                # open pages as several roles (PAGES / USERS env vars)
```

## Production checklist

1. **Hosting**: any Node host (or a container) plus managed PostgreSQL. Run `npm run build && npm start` behind HTTPS.
2. **Secrets**: a long random `CRON_SECRET`, plus SMTP credentials. Keep them in the host's secret store, not in git.
3. **Automation**: call `POST /api/cron` every 15 minutes with `Authorization: Bearer $CRON_SECRET`.
4. **Email**: set `SMTP_*`. Until then, emails are kept in Admin → Email outbox.
5. **Files**: `STORAGE_DIR` must be on persistent disk. For multiple servers, replace `src/lib/storage.ts` with S3/R2.
6. **Backups**: daily `pg_dump` plus a copy of `STORAGE_DIR` to a separate location. Encrypt backups and test restores (target: RPO ≤ 24 h, RTO ≤ 4 h).
7. **People**: at least two `system_admin` holders so the two-person rule works. Keep `ENFORCE_LEADER_MFA` on.
8. **Data protection**: get adoption approved through governance (plenary), publish a privacy notice, and set retention for alumni data.

## Code map

```
src/db/schema.ts           all tables (documented)
src/db/seed.ts             demo organisation (two terms)
src/lib/access.ts          permission engine (pure, tested)
src/lib/org.ts             org snapshot loader, labels
src/lib/provision.ts       create bodies (+tracker/KPIs), clone/close terms
src/lib/tracker-templates.ts  tracker templates per department/body type
src/lib/recruitment.ts     offer → NDA → account → onboarding
src/lib/insights.ts        health scores, reporting, attention list
src/jobs/engine.ts         automation engine
src/app/(portal)/…         portal pages (server components + server actions)
src/app/(public)/offer/…   candidate offer & NDA pages (token-guarded)
```
