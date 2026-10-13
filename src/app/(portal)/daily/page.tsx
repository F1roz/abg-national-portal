import { and, desc, eq } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { Card, Empty, Field, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { fmtDate, localDate, titleCase } from "@/lib/util";
import { submitDailyAction } from "./actions";

export const metadata = { title: "Daily update" };

/** Department-specific metrics shown on the daily update form. */
const METRICS: Record<string, string[]> = {
  OGX: ["calls", "leads", "applications", "follow_ups", "meetings"],
  ICX: ["partner_calls", "opportunities_opened", "applicants_screened", "follow_ups"],
  BD: ["partners_contacted", "meetings", "proposals_sent"],
  MKT: ["content_created", "posts_published", "leads"],
  FNL: ["payments_processed", "receivables_followed_up"],
  MX: ["one_on_ones", "members_contacted", "sessions_run"],
  IM: ["issues_resolved", "reports_built"],
};

export default async function DailyPage() {
  const { actor } = await requireActor();
  const today = localDate();
  const history = await db.select().from(s.dailyUpdates).where(eq(s.dailyUpdates.userId, actor.id)).orderBy(desc(s.dailyUpdates.date)).limit(14);
  const current = history.find((h) => h.date === today);
  const metricKeys = [...new Set([...actor.departmentKeys].flatMap((k) => METRICS[k] ?? []))];
  const keys = metricKeys.length ? metricKeys : ["meetings", "follow_ups", "tasks_progressed"];
  return (
    <>
      <PageHeader title="Daily update" subtitle={`How was your day? · ${fmtDate(today)}`} />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card title={current ? "Today's update (you can still edit it)" : "Today's update"} className="lg:col-span-3">
          <ActionForm action={submitDailyAction}>
            <Field label="What did you accomplish? *"><textarea name="accomplished" required rows={3} className="input" defaultValue={current?.accomplished} /></Field>
            <Field label="What are you working on?"><textarea name="workingOn" rows={2} className="input" defaultValue={current?.workingOn ?? ""} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="What blocked you?"><textarea name="blockers" rows={2} className="input" defaultValue={current?.blockers ?? ""} /></Field>
              <Field label="What support do you need?"><textarea name="supportNeeded" rows={2} className="input" defaultValue={current?.supportNeeded ?? ""} /></Field>
            </div>
            <Field label="What will you do tomorrow?"><textarea name="tomorrow" rows={2} className="input" defaultValue={current?.tomorrow ?? ""} /></Field>
            <div>
              <span className="label">Today's numbers</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {keys.map((k) => (
                  <label key={k} className="text-xs text-gray-600">{titleCase(k)}<input name={`m_${k}`} type="number" min={0} className="input mt-0.5" defaultValue={current?.metrics[k] ?? ""} /></label>
                ))}
              </div>
            </div>
            <SubmitButton>{current ? "Update" : "Submit daily update"}</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Last two weeks" className="lg:col-span-2">
          {history.length ? (
            <ul className="space-y-3 text-sm">
              {history.map((h) => (
                <li key={h.id} className="border-b border-gray-100 pb-2">
                  <div className="font-semibold">{fmtDate(h.date)}</div>
                  <div className="text-gray-700">{h.accomplished}</div>
                  {h.blockers ? <div className="text-xs text-orange-700">Blocked: {h.blockers}</div> : null}
                  {Object.keys(h.metrics).length ? <div className="mt-0.5 text-xs text-gray-500">{Object.entries(h.metrics).map(([k, v]) => `${titleCase(k)}: ${v}`).join(" · ")}</div> : null}
                </li>
              ))}
            </ul>
          ) : <Empty>No updates yet.</Empty>}
        </Card>
      </div>
    </>
  );
}
