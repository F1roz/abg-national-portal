import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireActor, denied } from "@/lib/session";
import { canViewBodyWork, leadsUser, usersInSubtree } from "@/lib/access";
import { reportingFor } from "@/lib/insights";
import { bodyPath, positionLabels, usersByIds } from "@/lib/org";
import { notify } from "@/lib/notify";
import { Card, Empty, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/forms";
import { fmtDateTime, localDate } from "@/lib/util";

export const metadata = { title: "Team reporting" };

async function nudge(form: FormData) {
  "use server";
  const { actor, org } = await requireActor();
  const ids = form.getAll("userId").map(String).filter((u) => actor.isMC || leadsUser(actor, org, u));
  await notify(ids, {
    type: "daily_update", priority: "normal", title: "Friendly reminder: today's daily update",
    body: `${actor.user.preferredName ?? actor.user.name} is checking in — is there anything blocking you or any support you need?`, link: "/daily",
    dedupeKey: `nudge:${localDate()}`,
  });
  revalidatePath("/reporting");
}

export default async function ReportingPage({ searchParams }: { searchParams: Promise<{ body?: string }> }) {
  const { actor, org } = await requireActor();
  if (!actor.isLeader && !actor.isMC) denied();
  const { body } = await searchParams;
  const scopes = [...org.bodies.values()].filter((b) => b.termId === org.termId && ["lc", "mc", "department", "team", "oc", "project", "synergy", "support"].includes(b.type) && canViewBodyWork(actor, org, b.id) && (actor.isMC || actor.ledBodyIds.has(b.id)));
  const scopeId = body && scopes.some((b) => b.id === body) ? body : [...actor.ledBodyIds][0] ?? scopes[0]?.id;
  const users = scopeId ? [...usersInSubtree(org, scopeId)].filter((u) => u !== actor.id) : [];
  const rows = await reportingFor(users, org.termId);
  const people = await usersByIds(users);
  rows.sort((a, b) => Number(a.dailyDone) - Number(b.dailyDone) || b.missedDays - a.missedDays);
  const missing = rows.filter((r) => !r.dailyDone).map((r) => r.userId);

  return (
    <>
      <PageHeader title="⏰ Team reporting" subtitle="Detect → remind → support → escalate. Missing a check-in is a signal to talk, not an automatic penalty." />
      <form className="mb-4 flex gap-2">
        <select name="body" defaultValue={scopeId} className="input max-w-md">{scopes.map((b) => <option key={b.id} value={b.id}>{bodyPath(org, b.id) || b.name}</option>)}</select>
        <button className="btn-secondary">Show</button>
      </form>
      <Card bodyClass="p-0" title={`${rows.length} people · ${rows.filter((r) => r.dailyDone).length} reported today`} actions={missing.length ? (
        <form action={nudge}>{missing.map((u) => <input key={u} type="hidden" name="userId" value={u} />)}<SubmitButton className="btn-secondary btn-sm">🔔 Nudge {missing.length} missing</SubmitButton></form>
      ) : null}>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Person</th><th>Check-in</th><th>Daily update</th><th>Missed (7d)</th><th>Open</th><th>Overdue</th><th>Completion</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.userId}>
                    <td><Link className="link font-medium" href={`/people/${r.userId}`}>{people.get(r.userId)?.name}</Link><div className="text-xs text-gray-500">{positionLabels(org, r.userId)[0]}</div></td>
                    <td>{r.checkedIn ? `✅ ${fmtDateTime(r.checkedIn).split(", ")[1]}` : "❌"}</td>
                    <td>{r.dailyDone ? "✅" : "❌"}</td>
                    <td className={r.missedDays >= 3 ? "font-semibold text-red-600" : ""}>{r.missedDays}</td>
                    <td>{r.openTasks}</td>
                    <td className={r.overdueTasks ? "font-semibold text-red-600" : ""}>{r.overdueTasks}</td>
                    <td>{r.completionPct === null ? "—" : `${r.completionPct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="p-4"><Empty>Nobody in this scope.</Empty></div>}
      </Card>
    </>
  );
}
