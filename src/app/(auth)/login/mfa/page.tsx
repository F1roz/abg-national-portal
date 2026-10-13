import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { getSession } from "@/lib/auth";
import { mfaAction } from "../actions";

export const metadata = { title: "Two-step verification" };

export default async function MfaPage() {
  const sess = await getSession();
  if (!sess) redirect("/login");
  if (sess.session.mfaVerified || !sess.user.mfaEnabled) redirect("/dashboard");
  return (
    <>
      <h1 className="mb-1 text-lg font-bold">Two-step verification</h1>
      <p className="mb-4 text-sm text-gray-500">Enter the 6-digit code from your authenticator app.</p>
      <ActionForm action={mfaAction}>
        <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required className="input text-center text-lg tracking-[0.4em]" autoFocus />
        <SubmitButton className="btn-primary w-full" pendingText="Verifying…">Verify</SubmitButton>
      </ActionForm>
      <form action="/logout" method="post" className="mt-3 text-center">
        <button className="text-sm text-gray-500 hover:underline">Use a different account</button>
      </form>
    </>
  );
}
