import { eq } from "drizzle-orm";
import { db, s } from "@/db";
import { holdersOfBody, type Org } from "./access";
import { audit } from "./audit";
import { notify } from "./notify";

/** Closes a motion and records the result (used by chairs and by the automation engine at closing time). */
export async function tallyMotion(org: Org, motionId: string, actorId: string | null) {
  const [m] = await db.select().from(s.motions).where(eq(s.motions.id, motionId));
  if (!m || m.status !== "open") return;
  const votes = await db.select().from(s.votes).where(eq(s.votes.motionId, motionId));
  const approve = votes.filter((v) => v.choice === "approve").length;
  const reject = votes.filter((v) => v.choice === "reject").length;
  const status = votes.length < m.quorum ? "no_quorum" : approve > reject ? "passed" : "rejected";
  await db.update(s.motions).set({ status }).where(eq(s.motions.id, motionId));
  await audit(actorId, "motion.closed", { type: "motion", id: motionId }, { code: m.code, approve, reject, abstain: votes.length - approve - reject, status });
  await notify(holdersOfBody(org, m.bodyId), { type: "governance", priority: "normal", title: `Motion ${m.code} ${status.replace("_", " ")}`, body: `${approve} approve · ${reject} reject · ${votes.length - approve - reject} abstain`, link: "/governance" });
}

