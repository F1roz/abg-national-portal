"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, s } from "@/db";
import { BLOCK_REASONS, PRIORITIES } from "@/db/schema";
import { requireActor } from "@/lib/session";
import { canAssignTaskTo } from "@/lib/access";
import { canViewTask, createTask, logTask, onTaskCompleted, reviewerOf } from "@/lib/tasks";
import { notify } from "@/lib/notify";
import { saveUpload } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { fmtDateTime, optStr, parseLocalDateTime, str } from "@/lib/util";
import type { FormState } from "@/components/forms";

export async function createTaskAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor, org } = await requireActor();
  const title = str(form, "title");
  if (title.length < 3) return { error: "Give the task a clear title." };
  const assignees = form.getAll("assigneeIds").map(String).filter(Boolean);
  if (!assignees.length) return { error: "Choose at least one assignee." };
  for (const a of assignees) if (!canAssignTaskTo(actor, org, a)) return { error: "You can only assign tasks to people within your scope." };
  const priority = str(form, "priority") as (typeof PRIORITIES)[number];
  const kpiId = optStr(form, "kpiId");
  const contribution = Number(str(form, "kpiContribution")) || null;
  let firstId = "";
  for (const assigneeId of assignees) {
    const t = await createTask(
      org, actor.id,
      {
        title, description: optStr(form, "description"), assigneeId, priority: PRIORITIES.includes(priority) ? priority : "medium",
        dueAt: parseLocalDateTime(str(form, "dueAt")), requireAck: form.get("requireAck") === "on", notifyChain: form.get("notifyChain") === "on",
        kpiId, kpiContribution: kpiId ? contribution : null, bodyId: optStr(form, "bodyId"), projectId: optStr(form, "projectId"),
        reviewerId: optStr(form, "reviewerId"),
      },
      { creatorName: actor.user.name, actor },
    );
    firstId ||= t.id;
  }
  revalidatePath("/tasks");
  redirect(assignees.length === 1 ? `/tasks/${firstId}` : "/tasks?view=assigned");
}

async function load(taskId: string) {
  const ctx = await requireActor();
  const [task] = await db.select().from(s.tasks).where(eq(s.tasks.id, taskId));
  if (!task || !canViewTask(ctx.actor, ctx.org, task)) throw new Error("Task not found");
  return { ...ctx, task };
}

export async function taskTransitionAction(form: FormData) {
  const taskId = str(form, "taskId");
  const op = str(form, "op");
  const { actor, org, task } = await load(taskId);
  const isAssignee = task.assigneeId === actor.id;
  const isReviewer = reviewerOf(task) === actor.id || task.createdById === actor.id;
  const name = actor.user.name;
  const now = new Date();
  const upd = (v: Partial<typeof s.tasks.$inferInsert>) => db.update(s.tasks).set({ ...v, updatedAt: now }).where(eq(s.tasks.id, taskId));

  switch (op) {
    case "ack":
      if (!isAssignee) break;
      await upd({ acknowledgedAt: now });
      await logTask(taskId, actor.id, "acknowledged", `${name} acknowledged the task (${fmtDateTime(now)})`);
      await notify([task.createdById], { type: "task_update", priority: "info", title: `${name} acknowledged "${task.title}"`, link: `/tasks/${taskId}` });
      break;
    case "start":
      if (!isAssignee) break;
      await upd({ status: "in_progress", startedAt: task.startedAt ?? now, blockedCategory: null, blockedReason: null });
      await logTask(taskId, actor.id, "started", `${name} started the task`);
      break;
    case "block": {
      if (!isAssignee) break;
      const category = str(form, "category");
      await upd({ status: "blocked", blockedCategory: (BLOCK_REASONS as readonly string[]).includes(category) ? category : "Other", blockedReason: optStr(form, "reason") });
      await logTask(taskId, actor.id, "blocked", `${name} marked the task BLOCKED — ${category}${str(form, "reason") ? `: ${str(form, "reason")}` : ""}`);
      await notify([task.createdById], { type: "task_blocked", priority: "important", title: `⚠️ ${name} marked "${task.title}" as BLOCKED`, body: `${category}${str(form, "reason") ? ` — ${str(form, "reason")}` : ""}`, link: `/tasks/${taskId}` });
      break;
    }
    case "submit":
      if (!isAssignee) break;
      if (task.createdById === actor.id && !task.reviewerId) {
        await upd({ status: "completed", completedAt: now, submittedAt: now });
        await logTask(taskId, actor.id, "completed", `${name} completed the task`);
        await onTaskCompleted(task, actor.id);
      } else {
        await upd({ status: "submitted", submittedAt: now });
        await logTask(taskId, actor.id, "submitted", `${name} submitted the task for review`);
        await notify([reviewerOf(task)], { type: "task_update", priority: "normal", title: `Ready for review: "${task.title}"`, body: `Submitted by ${name}`, link: `/tasks/${taskId}` });
      }
      break;
    case "approve":
      if (!isReviewer) break;
      await upd({ status: "completed", completedAt: now });
      await logTask(taskId, actor.id, "completed", `${name} reviewed and marked the task Completed`);
      await onTaskCompleted(task, actor.id);
      await notify([task.assigneeId], { type: "task_update", priority: "info", title: `✅ "${task.title}" was approved`, link: `/tasks/${taskId}` });
      break;
    case "rework": {
      if (!isReviewer) break;
      const note = str(form, "note");
      await upd({ status: "in_progress" });
      await logTask(taskId, actor.id, "rework", `${name} requested changes${note ? `: ${note}` : ""}`);
      await notify([task.assigneeId], { type: "task_update", priority: "important", title: `Changes requested on "${task.title}"`, body: note || undefined, link: `/tasks/${taskId}` });
      break;
    }
    case "reject":
      if (!isReviewer) break;
      await upd({ status: "rejected" });
      await logTask(taskId, actor.id, "rejected", `${name} rejected/cancelled the task`);
      await notify([task.assigneeId], { type: "task_update", title: `"${task.title}" was rejected/cancelled`, link: `/tasks/${taskId}` });
      break;
    case "reopen":
      if (!isReviewer) break;
      await upd({ status: "in_progress", completedAt: null });
      await logTask(taskId, actor.id, "reopened", `${name} reopened the task`);
      break;
    case "extension": {
      if (!isAssignee) break;
      const until = str(form, "until");
      const reason = str(form, "reason");
      await logTask(taskId, actor.id, "extension_requested", `${name} asked for an extension${until ? ` until ${until.replace("T", " ")}` : ""}${reason ? ` — ${reason}` : ""}`);
      await notify([task.createdById], { type: "task_update", priority: "important", title: `Extension requested: "${task.title}"`, body: reason || undefined, link: `/tasks/${taskId}` });
      break;
    }
    case "deadline": {
      if (!isReviewer) break;
      const due = parseLocalDateTime(str(form, "dueAt"));
      await upd({ dueAt: due, reminderStage: null, escalationLevel: 0 });
      await logTask(taskId, actor.id, "deadline", `${name} changed the deadline to ${due ? fmtDateTime(due) : "none"}`);
      await notify([task.assigneeId], { type: "task_update", priority: "normal", title: `Deadline changed: "${task.title}"`, body: due ? `New deadline ${fmtDateTime(due)}` : "Deadline removed", link: `/tasks/${taskId}` });
      break;
    }
    case "reassign": {
      if (!isReviewer) break;
      const to = str(form, "assigneeId");
      if (!to || !canAssignTaskTo(actor, org, to)) break;
      await upd({ assigneeId: to, acknowledgedAt: null, status: "not_started" });
      const [u] = await db.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, to));
      await logTask(taskId, actor.id, "reassigned", `${name} reassigned the task to ${u?.name}`);
      await notify([to], { type: "task_assigned", priority: "important", title: `Task reassigned to you: ${task.title}`, link: `/tasks/${taskId}` });
      await notify([task.assigneeId], { type: "task_update", priority: "info", title: `"${task.title}" was reassigned to ${u?.name}`, link: `/tasks/${taskId}` });
      await audit(actor.id, "task.reassigned", { type: "task", id: taskId }, { from: task.assigneeId, to });
      break;
    }
  }
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/tasks");
}

export async function commentAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor, task } = await load(str(form, "taskId"));
  const body = str(form, "body");
  if (!body) return { error: "Write a comment first." };
  await db.insert(s.taskComments).values({ taskId: task.id, authorId: actor.id, body: body.slice(0, 5000) });
  await logTask(task.id, actor.id, "comment", `${actor.user.name} commented`);
  const others = [task.assigneeId, task.createdById, task.reviewerId].filter((u): u is string => !!u && u !== actor.id);
  await notify(others, { type: "task_comment", priority: "info", title: `${actor.user.name} commented on "${task.title}"`, body: body.slice(0, 140), link: `/tasks/${task.id}` });
  revalidatePath(`/tasks/${task.id}`);
  return { ok: true };
}

export async function attachAction(_: FormState, form: FormData): Promise<FormState> {
  const { actor, task } = await load(str(form, "taskId"));
  const file = form.get("file");
  const url = str(form, "url");
  try {
    if (file instanceof File && file.size > 0) {
      const fileId = await saveUpload(file, actor.id);
      await db.insert(s.taskAttachments).values({ taskId: task.id, fileId, label: file.name, addedById: actor.id });
      await logTask(task.id, actor.id, "attachment", `${actor.user.name} uploaded ${file.name}`);
    } else if (/^https:\/\//.test(url)) {
      await db.insert(s.taskAttachments).values({ taskId: task.id, url, label: str(form, "label") || url, addedById: actor.id });
      await logTask(task.id, actor.id, "attachment", `${actor.user.name} attached a link`);
    } else {
      return { error: "Choose a file or paste an https:// link." };
    }
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/tasks/${task.id}`);
  return { ok: true, message: "Attached." };
}
