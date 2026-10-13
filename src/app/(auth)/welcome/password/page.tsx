import { ActionForm, SubmitButton } from "@/components/forms";
import { requireActor } from "@/lib/session";
import { changePasswordAction } from "../actions";

export const metadata = { title: "Change your password" };

export default async function ForcePasswordPage() {
  await requireActor({ stage: "security" });
  return (
    <>
      <h1 className="mb-1 text-lg font-bold">Change your temporary password</h1>
      <p className="mb-4 text-sm text-gray-500">For your security, choose a new password before continuing.</p>
      <ActionForm action={changePasswordAction}>
        <input type="hidden" name="redirect" value="welcome" />
        <input name="current" type="password" required placeholder="Temporary password" className="input" autoComplete="current-password" />
        <input name="password" type="password" required minLength={10} placeholder="New password" className="input" autoComplete="new-password" />
        <input name="confirm" type="password" required minLength={10} placeholder="Repeat new password" className="input" autoComplete="new-password" />
        <SubmitButton className="btn-primary w-full">Change password</SubmitButton>
      </ActionForm>
    </>
  );
}
