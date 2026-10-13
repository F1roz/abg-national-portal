import { and, eq } from "drizzle-orm";
import { db, s } from "@/db";
import { bodiesOfUser, canAssignTaskTo, canManageBody, leadsUser, supervisorChain, type Actor, type Org } from "./access";
import { notify } from "./notify";
import { checkOnboardingComplete } from "./onboarding";
import { localDate } from "./util";

export type Task = typeof s.tasks.$inferSelect;

export function canViewTask(actor: Actor, org: Org, t: Task): boolean {
  if ([t.assigneeId, t.createdById, t.reviewerId].includes(actor.id)) return true;
  if (leadsUser(actor, org, t.assigneeId)) return true;
  return !!t.bodyId && canManageBody(actor, org, t.bodyId);
}

/** Who reviews/approves completion: the reviewer, else the assigner. */
export function reviewerOf(t: Task): string {
  return t.reviewerId ?? t.createdById;
}

export async function logTask(taskId: string, actorId: string | null, type: string, message: string) {
  await db.insert(s.taskEvents).values({ taskId, actorId, type, message });
  await db.update(s.tasks).set({ updatedAt: new Date() }).where(eq(s.tasks.id, taskId));
}

export type NewTask = {
  title: string;
  description?: string | null;
  assigneeId: string;
  reviewerId?: string | null;
  bodyId?: string | null;
  projectId?: string | null;
  parentTaskId?: string | null;
  priority?: "low" | "medium" | "high" | "critical";
  dueAt?: Date | null;
  requireAck?: boolean;
  kpiId?: string | null;
  kpiContribution?: number | null;
  notifyChain?: boolean;
  category?: "work" | "onboarding" | "report" | "handover";
  recurringId?: string | null;
};

/** Creates a task and notifies the assignee (and, optionally, the leaders in between). */
export async function createTask(org: Org, creatorId: string, input: NewTask, opts: { creatorName: string; skipPermission?: boolean; actor?: Actor }) {
  if (!opts.skipPermission && opts.actor && !canAssignTaskTo(opts.actor, org, input.assigneeId)) {
    throw new Error("You can only assign tasks to people in your scope.");
  }
  const bodyId = input.bodyId ?? bodiesOfUser(org, input.assigneeId)[0] ?? null;
  const [task] = await db
    .insert(s.tasks)
    .values({
      termId: org.termId, title: input.title, description: input.description ?? null, createdById: creatorId, assigneeId: input.assigneeId,
      reviewerId: input.reviewerId ?? null, bodyId, projectId: input.projectId ?? null, parentTaskId: input.parentTaskId ?? null,
      priority: input.priority ?? "medium", dueAt: input.dueAt ?? null, requireAck: input.requireAck ?? false, kpiId: input.kpiId ?? null,
      kpiContribution: input.kpiContribution ?? null, notifyChain: input.notifyChain ?? false, category: input.category ?? "work", recurringId: input.recurringId ?? null,
    })
    .returning();
  await logTask(task!.id, creatorId, "created", `${opts.creatorName} assigned the task`);
  if (input.assigneeId !== creatorId) {
    await notify([input.assigneeId], {
      type: "task_assigned", priority: input.priority === "critical" ? "critical" : input.priority === "high" ? "important" : "normal",
      title: `New task: ${input.title}`, body: `Assigned by ${opts.creatorName}${input.dueAt ? ` · due ${localDate(input.dueAt)}` : ""}${input.requireAck ? " · acknowledgement required" : ""}`,
      link: `/tasks/${task!.id}`,
    });
  }
  if (input.notifyChain) {
    // Inform the leaders between the assigner and the assignee (e.g. MCVP → member: TL + LCVP get an FYI).
    const chain = supervisorChain(org, input.assigneeId).flat().filter((u) => u !== creatorId);
    const between: string[] = [];
    for (const u of chain) {
      if (u === creatorId) break;
      between.push(u);
      if (between.length >= 3) break;
    }
    await notify(between, { type: "task_update", priority: "info", title: `FYI: ${opts.creatorName} assigned "${input.title}" to someone in your team`, link: `/tasks/${task!.id}` });
  }
  return task!;
}

/** When a task completes: credit its KPI and tick the linked onboarding item. */
export async function onTaskCompleted(t: Task, actorId: string) {
  if (t.kpiId && t.kpiContribution) {
    const [existing] = await db.select().from(s.kpiEntries).where(and(eq(s.kpiEntries.taskId, t.id), eq(s.kpiEntries.kpiId, t.kpiId)));
    if (!existing) {
      await db.insert(s.kpiEntries).values({ kpiId: t.kpiId, value: t.kpiContribution, occurredOn: localDate(), source: "task", taskId: t.id, note: `Task completed: ${t.title}`, createdById: actorId });
    }
  }
  const linked = await db.update(s.onboardingItems).set({ doneAt: new Date() }).where(eq(s.onboardingItems.taskId, t.id)).returning();
  if (linked.length) await checkOnboardingComplete(t.assigneeId);
}
