import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, s } from "@/db";
import { findOfferByToken, setCandidateStatus, candidateVars } from "@/lib/recruitment";
import { loadOrgData } from "@/lib/org";
import { audit } from "@/lib/audit";
import { ActionForm, SubmitButton } from "@/components/forms";
import { fmtDate } from "@/lib/util";
import { acceptOfferAction, declineOfferAction } from "./actions";

export const metadata = { title: "Your offer", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function OfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await findOfferByToken(token);
  if (!found || found.offer.status === "revoked") {
    return <div className="card p-6 text-center"><h1 className="text-lg font-bold">This link is not valid</h1><p className="text-sm text-gray-500">It may have been replaced by a newer offer. Please check your latest email or contact the recruitment team.</p></div>;
  }
  const { offer, candidate } = found;
  if (offer.expiresAt < new Date() && (offer.status === "sent" || offer.status === "viewed")) {
    await db.update(s.offers).set({ status: "expired" }).where(eq(s.offers.id, offer.id));
    await setCandidateStatus(candidate.id, "offer_expired", null);
    offer.status = "expired";
  }
  if (offer.status === "expired") return <div className="card p-6 text-center"><h1 className="text-lg font-bold">This offer has expired</h1><p className="text-sm text-gray-500">Please contact the recruitment team.</p></div>;
  if (offer.status === "sent") {
    await db.update(s.offers).set({ status: "viewed", viewedAt: new Date() }).where(eq(s.offers.id, offer.id));
    await setCandidateStatus(candidate.id, "offer_viewed", null);
    await audit(null, "offer.viewed", { type: "offer", id: offer.id }, { code: offer.code });
  }
  const vars = await candidateVars(await loadOrgData(), candidate);
  const open = offer.status === "sent" || offer.status === "viewed";
  return (
    <>
      <div className="mb-6 text-center">
        <div className="text-4xl">🎉</div>
        <h1 className="text-2xl font-bold">Congratulations, {vars.preferred_name}!</h1>
        <p className="text-gray-600">You have been selected for <strong>{vars.position}</strong></p>
        <p className="text-sm text-gray-500">{vars.department} · {vars.lc_name} · Term {vars.term} · Reporting to {vars.reporting_manager} · Starts {vars.start_date}</p>
      </div>
      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">🔒 This offer is personal and confidential. Do not share this link.</div>
      <article className="card prose-doc p-6" dangerouslySetInnerHTML={{ __html: offer.renderedBody }} />
      <p className="mt-2 text-xs text-gray-400">Offer {offer.code} · valid until {fmtDate(offer.expiresAt)} · document fingerprint {offer.contentSha256.slice(0, 16)}…</p>
      {open ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="card p-4">
            <h2 className="mb-2 font-semibold">Accept offer</h2>
            <ActionForm action={acceptOfferAction}>
              <input type="hidden" name="token" value={token} />
              <input name="email" type="email" required placeholder="Confirm your email address" className="input" />
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" className="mt-1" /> I have read and understood the offer letter and accept the position described above.</label>
              <SubmitButton className="btn-primary w-full">ACCEPT OFFER</SubmitButton>
            </ActionForm>
          </div>
          <details className="card p-4">
            <summary className="cursor-pointer font-semibold">Decline offer</summary>
            <ActionForm action={declineOfferAction} className="mt-2 space-y-2">
              <input type="hidden" name="token" value={token} />
              <input name="email" type="email" required placeholder="Confirm your email address" className="input" />
              <textarea name="reason" rows={2} placeholder="Reason (optional)" className="input" />
              <SubmitButton className="btn-secondary w-full" confirm="Decline this offer?">Decline</SubmitButton>
            </ActionForm>
          </details>
        </div>
      ) : offer.status === "accepted" ? (
        <div className="mt-6 card p-4 text-center">✅ You accepted this offer. {candidate.status === "nda_pending" ? <Link className="btn-primary ml-2" href={`/offer/${token}/nda`}>Continue to NDA →</Link> : "Check your email to activate your portal account."}</div>
      ) : (
        <div className="mt-6 card p-4 text-center text-gray-600">This offer was {offer.status}.</div>
      )}
    </>
  );
}
