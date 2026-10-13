import { findOfferByToken, activeTemplate, candidateVars } from "@/lib/recruitment";
import { loadOrgData } from "@/lib/org";
import { renderTemplate } from "@/lib/templates";
import { ActionForm, SubmitButton } from "@/components/forms";
import { sha256 } from "@/lib/util";
import { signNdaAction } from "../actions";

export const metadata = { title: "Non-Disclosure Agreement", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function NdaPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const found = await findOfferByToken(token);
  if (!found || found.offer.status !== "accepted") return <div className="card p-6 text-center">This link is not valid for the NDA step.</div>;
  const { candidate } = found;
  if (done || candidate.status !== "nda_pending") {
    return (
      <div className="card p-8 text-center">
        <div className="text-4xl">🔐</div>
        <h1 className="mt-2 text-xl font-bold">NDA signed — your account is being set up</h1>
        <p className="mt-1 text-gray-600">We've emailed <strong>{candidate.email}</strong> a secure link to activate your portal account and set your password. The link expires in 72 hours.</p>
      </div>
    );
  }
  const tpl = await activeTemplate("nda");
  const content = tpl ? renderTemplate(tpl.body, await candidateVars(await loadOrgData(), candidate)) : "<p>NDA template missing.</p>";
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">🔐 Non-Disclosure Agreement</h1>
      <p className="mb-4 text-sm text-gray-500">Version {tpl?.version}. Read the whole agreement before signing. It cannot be modified.</p>
      <article className="card prose-doc max-h-[60vh] overflow-y-auto p-6" dangerouslySetInnerHTML={{ __html: content }} />
      <div className="card mt-6 p-4">
        <ActionForm action={signNdaAction}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="contentHash" value={sha256(content)} />
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" className="mt-1" /> I have read, understood, and agree to the terms of this NDA.</label>
          <label className="block"><span className="label">Full legal name (signature)</span><input name="signedName" required className="input" placeholder={candidate.fullName} /></label>
          <SubmitButton className="btn-primary w-full">SIGN & CONTINUE</SubmitButton>
        </ActionForm>
      </div>
    </>
  );
}
