import { desc } from "drizzle-orm";
import { db, s } from "@/db";
import { requireFullAdmin } from "../guard";
import { getSettings } from "@/lib/settings";
import { usersByIds } from "@/lib/org";
import { Badge, Card, Field } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { fmtDateTime } from "@/lib/util";
import { createRecurringAction, runJobsAction, saveSettingsAction, toggleRecurringAction } from "../actions";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function AutomationAdmin() {
  const { org } = await requireFullAdmin();
  const cfg = await getSettings();
  const runs = await db.select().from(s.jobRuns).orderBy(desc(s.jobRuns.startedAt)).limit(8);
  const recurring = await db.select().from(s.recurringTasks).orderBy(desc(s.recurringTasks.createdAt));
  const holders = await usersByIds(recurring.flatMap((r) => org.holders.get(r.positionId) ?? []));
  const positions = [...org.positions.values()].filter((p) => org.bodies.get(p.bodyId)?.termId === org.termId);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Run now">
        <ActionForm action={runJobsAction}><p className="text-sm text-gray-600">Runs recurring tasks, reminders & escalations, daily-update nudges, offer reminders/expiry, onboarding alerts, motion closing, document expiry, weekly summaries and email delivery. Safe to run any time — everything is idempotent.</p><SubmitButton pendingText="Running…">▶ Run automations</SubmitButton></ActionForm>
        <ul className="mt-4 space-y-2 text-xs">{runs.map((r) => <li key={r.id}><strong>{fmtDateTime(r.startedAt)}</strong> <Badge>{r.trigger}</Badge><div className="text-gray-500">{Object.entries(r.result).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div></li>)}</ul>
      </Card>
      <Card title="Thresholds (no code changes needed)">
        <ActionForm action={saveSettingsAction} className="grid gap-3 sm:grid-cols-2">
          <Field label="Reminders before deadline (hours)"><input name="reminderHoursBefore" defaultValue={cfg.reminderHoursBefore.join(", ")} className="input" /></Field>
          <Field label="Daily reminder after (hour)"><input name="dailyReminderHour" type="number" defaultValue={cfg.dailyReminderHour} className="input" /></Field>
          <Field label="Overdue: nudge assignee (days)"><input name="od1" type="number" defaultValue={cfg.escalationDays.stillOverdue} className="input" /></Field>
          <Field label="Overdue: notify assigner (days)"><input name="od2" type="number" defaultValue={cfg.escalationDays.notifyAssigner} className="input" /></Field>
          <Field label="Overdue: escalate to supervisor (days)"><input name="od3" type="number" defaultValue={cfg.escalationDays.escalate} className="input" /></Field>
          <Field label="Overdue: support flag next level (days)"><input name="od4" type="number" defaultValue={cfg.escalationDays.flag} className="input" /></Field>
          <Field label="Missed updates → inform leader"><input name="missedL1" type="number" defaultValue={cfg.missedUpdatesNotifyLeader} className="input" /></Field>
          <Field label="Missed updates → inform next level"><input name="missedL2" type="number" defaultValue={cfg.missedUpdatesNotifyNextLevel} className="input" /></Field>
          <Field label="Weekend days (0=Sun … 6=Sat)"><input name="weekendDays" defaultValue={cfg.weekendDays.join(", ")} className="input" /></Field>
          <Field label="Offer reminders after (hours)"><input name="offerReminderHours" defaultValue={cfg.offerReminderHours.join(", ")} className="input" /></Field>
          <Field label="Final offer reminder before expiry (hours)"><input name="offerFinal" type="number" defaultValue={cfg.offerFinalReminderHours} className="input" /></Field>
          <Field label="Onboarding grace period (days)"><input name="onboardingGraceDays" type="number" defaultValue={cfg.onboardingGraceDays} className="input" /></Field>
          <Field label="Document expiry warnings (days)"><input name="documentExpiryWarnDays" defaultValue={cfg.documentExpiryWarnDays.join(", ")} className="input" /></Field>
          <div className="sm:col-span-2"><SubmitButton>Save thresholds</SubmitButton></div>
        </ActionForm>
      </Card>
      <Card title="Recurring tasks" className="lg:col-span-2">
        <table className="table mb-4"><thead><tr><th>Task</th><th>Position (current holder)</th><th>Cadence</th><th>Last generated</th><th /></tr></thead>
          <tbody>{recurring.map((r) => { const p = org.positions.get(r.positionId); return (
            <tr key={r.id}><td>{r.title}</td><td className="text-xs">{p?.title} · {org.bodies.get(p?.bodyId ?? "")?.name}<div className="text-gray-500">{(org.holders.get(r.positionId) ?? []).map((u) => holders.get(u)?.name).join(", ") || "vacant"}</div></td><td className="text-xs">{r.cadence}{r.cadence === "weekly" ? ` · ${DAYS[r.weekday ?? 0]}` : r.cadence === "monthly" ? ` · day ${r.dayOfMonth}` : ""} · due {r.dueHour}:00</td><td className="text-xs">{r.lastGeneratedOn ?? "—"}</td>
              <td><form action={toggleRecurringAction}><input type="hidden" name="id" value={r.id} /><SubmitButton className="btn-ghost btn-sm">{r.active ? "Pause" : "Resume"}</SubmitButton></form></td></tr>
          ); })}</tbody>
        </table>
        <ActionForm action={createRecurringAction} resetOnSuccess className="grid gap-2 md:grid-cols-6">
          <input name="title" placeholder="e.g. Weekly portfolio report" className="input md:col-span-2" />
          <select name="positionId" className="input md:col-span-2">{positions.map((p) => <option key={p.id} value={p.id}>{p.title} · {org.bodies.get(p.bodyId)?.shortName ?? org.bodies.get(p.bodyId)?.name}</option>)}</select>
          <select name="cadence" className="input"><option value="weekly">Weekly</option><option value="daily">Daily</option><option value="monthly">Monthly</option></select>
          <select name="weekday" className="input">{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
          <input name="dayOfMonth" type="number" min={1} max={28} placeholder="Day (monthly)" className="input" />
          <input name="dueHour" type="number" min={0} max={23} defaultValue={23} className="input" />
          <div className="md:col-span-4"><SubmitButton className="btn-secondary">Schedule</SubmitButton></div>
        </ActionForm>
      </Card>
    </div>
  );
}
