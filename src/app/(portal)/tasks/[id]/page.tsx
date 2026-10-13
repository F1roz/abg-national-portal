import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, s } from "@/db";
import { BLOCK_REASONS } from "@/db/schema";
import { requireActor } from "@/lib/session";
import { canViewTask, reviewerOf } from "@/lib/tasks";
import { assignablePeople } from "@/lib/people";
import { bodyPath, usersByIds } from "@/lib/org";
import { Card, PriorityBadge, StatusBadge, Badge } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { fmtDateTime, relTime, toLocalInput } from "@/lib/util";
import { attachAction, commentAction, taskTransitionAction } from "../actions";

export const metadata = { title: "Task" };

function Op({ taskId, op, label, cls = "btn-secondary btn-sm", confirm }: { taskId: string; op: string; label: string; cls?: string; confirm?: string }) {
  return (
    <form action={taskTransitionAction}>
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="op" value={op} />
      <SubmitButton className={cls} confirm={confirm}>{label}</SubmitButton>
    </form>
  );
}

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, org } = await requireActor();
  const [task] = await db.select().from(s.tasks).where(eq(s.tasks.id, id));
  if (!task || !canViewTask(actor, org, task)) notFound();
  const [events, comments, attachments, kpi] = await Promise.all([
    db.select().from(s.taskEvents).where(eq(s.taskEvents.taskId, id)).orderBy(asc(s.taskEvents.createdAt)),
    db.select().from(s.taskComments).where(eq(s.taskComments.taskId, id)).orderBy(asc(s.taskComments.createdAt)),
    db.select().from(s.taskAttachments).where(eq(s.taskAttachments.taskId, id)),
    task.kpiId ? db.select().from(s.kpis).where(eq(s.kpis.id, task.kpiId)).then((r) => r[0]) : Promise.resolve(undefined),
  ]);
  const people = await usersByIds([task.assigneeId, task.createdById, task.reviewerId ?? task.createdById, ...comments.map((c) => c.authorId)]);
  const isAssignee = task.assigneeId === actor.id;
  const isReviewer = reviewerOf(task) === actor.id || task.createdById === actor.id;
  const open = !["completed", "rejected"].includes(task.status);
  const late = open && task.dueAt && task.dueAt < new Date();
  const reassignable = isReviewer && open ? await assignablePeople(actor, org) : [];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div>
          <Link href="/tasks" className="text-sm text-gray-500 hover:underline">← Tasks</Link>
          <h1 className="mt-1 text-2xl font-bold">{task.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={task.status} /><PriorityBadge priority={task.priority} />
            {task.category !== "work" ? <Badge tone="purple">{task.category}</Badge> : null}
            {late ? <Badge tone="red">Overdue {relTime(task.dueAt!)}</Badge> : null}
            {task.escalationLevel > 0 ? <Badge tone="red">Escalated ×{task.escalationLevel}</Badge> : null}
          </div>
        </div>

        {task.requireAck && !task.acknowledgedAt && isAssignee ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <span className="text-sm text-red-800">{people.get(task.createdById)?.name} requires you to acknowledge this task.</span>
            <Op taskId={id} op="ack" label="I acknowledge this task" cls="btn-danger btn-sm" />
          </div>
        ) : null}
        {task.status === "blocked" ? (
          <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800">
            ⚠️ <strong>Blocked</strong> — {task.blockedCategory}{task.blockedReason ? `: ${task.blockedReason}` : ""}
          </div>
        ) : null}

        <Card title="Details">
          <p className="whitespace-pre-wrap text-sm text-gray-700">{task.description || <span className="text-gray-400">No description.</span>}</p>
          {kpi ? <p className="mt-3 text-sm">📊 Contributes <strong>+{task.kpiContribution}</strong> to KPI <Link className="link" href={`/bodies/${kpi.bodyId}`}>{kpi.name}</Link> on completion.</p> : null}
        </Card>

        {open ? (
          <Card title="Actions">
            <div className="flex flex-wrap gap-2">
              {isAssignee && task.status === "not_started" ? <Op taskId={id} op="start" label="▶ Start task" cls="btn-primary btn-sm" /> : null}
              {isAssignee && task.status === "blocked" ? <Op taskId={id} op="start" label="Unblock & continue" cls="btn-primary btn-sm" /> : null}
              {isAssignee && ["not_started", "in_progress"].includes(task.status) ? <Op taskId={id} op="submit" label={task.createdById === actor.id && !task.reviewerId ? "✓ Mark complete" : "📤 Submit for review"} cls="btn-primary btn-sm" /> : null}
              {isReviewer && task.status === "submitted" ? <Op taskId={id} op="approve" label="✓ Approve & complete" cls="btn-primary btn-sm" /> : null}
              {isReviewer ? <Op taskId={id} op="reject" label="Cancel task" cls="btn-ghost btn-sm" confirm="Cancel this task?" /> : null}
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {isAssignee && task.status !== "blocked" ? (
                <form action={taskTransitionAction} className="space-y-2 rounded-lg bg-gray-50 p-3">
                  <input type="hidden" name="taskId" value={id} /><input type="hidden" name="op" value="block" />
                  <div className="text-sm font-semibold">I&apos;m blocked</div>
                  <select name="category" className="input">{BLOCK_REASONS.map((r) => <option key={r}>{r}</option>)}</select>
                  <input name="reason" className="input" placeholder="What do you need?" />
                  <SubmitButton className="btn-secondary btn-sm">Mark blocked</SubmitButton>
                </form>
              ) : null}
              {isAssignee ? (
                <form action={taskTransitionAction} className="space-y-2 rounded-lg bg-gray-50 p-3">
                  <input type="hidden" name="taskId" value={id} /><input type="hidden" name="op" value="extension" />
                  <div className="text-sm font-semibold">Ask for an extension</div>
                  <input name="until" type="datetime-local" className="input" />
                  <input name="reason" className="input" placeholder="Reason" />
                  <SubmitButton className="btn-secondary btn-sm">Request</SubmitButton>
                </form>
              ) : null}
              {isReviewer && task.status === "submitted" ? (
                <form action={taskTransitionAction} className="space-y-2 rounded-lg bg-gray-50 p-3">
                  <input type="hidden" name="taskId" value={id} /><input type="hidden" name="op" value="rework" />
                  <div className="text-sm font-semibold">Request changes</div>
                  <input name="note" className="input" placeholder="What needs to change?" />
                  <SubmitButton className="btn-secondary btn-sm">Send back</SubmitButton>
                </form>
              ) : null}
              {isReviewer ? (
                <form action={taskTransitionAction} className="space-y-2 rounded-lg bg-gray-50 p-3">
                  <input type="hidden" name="taskId" value={id} /><input type="hidden" name="op" value="deadline" />
                  <div className="text-sm font-semibold">Change deadline</div>
                  <input name="dueAt" type="datetime-local" className="input" defaultValue={toLocalInput(task.dueAt)} />
                  <SubmitButton className="btn-secondary btn-sm">Update</SubmitButton>
                </form>
              ) : null}
              {isReviewer && reassignable.length ? (
                <form action={taskTransitionAction} className="space-y-2 rounded-lg bg-gray-50 p-3">
                  <input type="hidden" name="taskId" value={id} /><input type="hidden" name="op" value="reassign" />
                  <div className="text-sm font-semibold">Reassign</div>
                  <select name="assigneeId" className="input" defaultValue={task.assigneeId}>{reassignable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                  <SubmitButton className="btn-secondary btn-sm">Reassign</SubmitButton>
                </form>
              ) : null}
            </div>
          </Card>
        ) : isReviewer ? (
          <div><Op taskId={id} op="reopen" label="Reopen task" /></div>
        ) : null}

        <Card title={`Discussion (${comments.length})`}>
          <ul className="mb-4 space-y-3">
            {comments.map((c) => (
              <li key={c.id} className="text-sm">
                <span className="font-semibold">{people.get(c.authorId)?.name}</span> <span className="text-xs text-gray-400">{fmtDateTime(c.createdAt)}</span>
                <p className="whitespace-pre-wrap text-gray-700">{c.body}</p>
              </li>
            ))}
          </ul>
          <ActionForm action={commentAction} resetOnSuccess className="flex gap-2">
            <input type="hidden" name="taskId" value={id} />
            <input name="body" className="input" placeholder="Write a comment…" />
            <SubmitButton className="btn-primary">Send</SubmitButton>
          </ActionForm>
        </Card>
      </div>

      <div className="space-y-6">
        <Card title="People & dates">
          <dl className="space-y-2 text-sm">
            <div><dt className="label">Assigned by</dt><dd>{people.get(task.createdById)?.name}</dd></div>
            <div><dt className="label">Assignee</dt><dd>{people.get(task.assigneeId)?.name}</dd></div>
            <div><dt className="label">Reviewer</dt><dd>{people.get(reviewerOf(task))?.name}</dd></div>
            <div><dt className="label">Deadline</dt><dd className={late ? "font-semibold text-red-600" : ""}>{fmtDateTime(task.dueAt)}</dd></div>
            {task.bodyId ? <div><dt className="label">Body</dt><dd><Link className="link" href={`/bodies/${task.bodyId}`}>{bodyPath(org, task.bodyId)}</Link></dd></div> : null}
            {task.acknowledgedAt ? <div><dt className="label">Acknowledged</dt><dd>{fmtDateTime(task.acknowledgedAt)}</dd></div> : null}
          </dl>
        </Card>
        <Card title="Attachments">
          <ul className="mb-3 space-y-1 text-sm">
            {attachments.map((a) => (
              <li key={a.id}>📎 {a.fileId ? <a className="link" href={`/api/files/task/${a.id}`}>{a.label}</a> : <a className="link" href={a.url!} target="_blank" rel="noreferrer noopener">{a.label}</a>}</li>
            ))}
            {!attachments.length ? <li className="text-gray-400">None yet.</li> : null}
          </ul>
          <ActionForm action={attachAction} resetOnSuccess className="space-y-2">
            <input type="hidden" name="taskId" value={id} />
            <input type="file" name="file" className="block w-full text-xs" />
            <input name="url" className="input" placeholder="…or https:// link (Drive, Sheets)" />
            <SubmitButton className="btn-secondary btn-sm">Attach</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Activity">
          <ol className="relative space-y-3 border-l border-gray-200 pl-4 text-sm">
            {events.map((e) => (
              <li key={e.id}>
                <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-brand" />
                <div className="text-xs text-gray-400">{fmtDateTime(e.createdAt)}</div>
                <div>{e.message}</div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
