import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, s } from "@/db";
import { ActionForm, SubmitButton } from "@/components/forms";
import { requireActor } from "@/lib/session";
import { positionLabels } from "@/lib/org";
import { completeWelcomeAction } from "./actions";

export const metadata = { title: "Welcome" };

export default async function WelcomePage() {
  const { actor, org } = await requireActor({ stage: "onboarding" });
  if (actor.user.termsAcceptedAt && actor.user.profileCompletedAt) redirect("/dashboard");
  const labels = positionLabels(org, actor.id);
  const [nda] = await db.select().from(s.ndaSignatures).where(and(eq(s.ndaSignatures.userId, actor.id), isNotNull(s.ndaSignatures.signedAt))).limit(1);
  const u = actor.user;
  return (
    <>
      <h1 className="text-lg font-bold">🎉 Welcome to AIESEC in Bangladesh, {u.preferredName ?? u.name.split(" ")[0]}!</h1>
      {labels.length ? <p className="mt-1 text-sm text-gray-600">You are joining as <strong>{labels.join(", ")}</strong>.</p> : null}
      <p className="mt-1 mb-4 text-sm text-gray-500">Your onboarding journey starts here. First, a few details.</p>
      <div className="mb-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
        NDA: {nda ? <span className="text-green-700">✅ signed</span> : <span>not on record — your MX team will follow up if required.</span>} · <Link href="/my-position" className="link">Read your position JD</Link>
      </div>
      <ActionForm action={completeWelcomeAction}>
        <label className="block"><span className="label">Preferred name</span><input name="preferredName" defaultValue={u.preferredName ?? ""} className="input" /></label>
        <label className="block"><span className="label">Phone *</span><input name="phone" defaultValue={u.phone ?? ""} required className="input" /></label>
        <label className="block"><span className="label">University *</span><input name="university" defaultValue={u.university ?? ""} required className="input" /></label>
        <label className="block"><span className="label">Emergency contact (restricted)</span><input name="emergencyContact" defaultValue={u.emergencyContact ?? ""} className="input" /></label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="terms" className="mt-1" />
          <span>I accept the portal terms of use: I will use the portal for AIESEC work only, keep confidential information confidential, and not share my account.</span>
        </label>
        <SubmitButton className="btn-primary w-full">Continue to onboarding</SubmitButton>
      </ActionForm>
    </>
  );
}
