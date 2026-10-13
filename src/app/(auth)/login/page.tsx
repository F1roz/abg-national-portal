import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { getSession } from "@/lib/auth";
import { loginAction } from "./actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const sess = await getSession();
  if (sess && (sess.session.mfaVerified || !sess.user.mfaEnabled)) redirect("/dashboard");
  return (
    <>
      <h1 className="mb-1 text-lg font-bold">Sign in</h1>
      <p className="mb-4 text-sm text-gray-500">Use your AIESEC Bangladesh portal account.</p>
      <ActionForm action={loginAction}>
        <label className="block">
          <span className="label">Email</span>
          <input name="email" type="email" autoComplete="username" required className="input" />
        </label>
        <label className="block">
          <span className="label">Password</span>
          <input name="password" type="password" autoComplete="current-password" required className="input" />
        </label>
        <SubmitButton className="btn-primary w-full" pendingText="Signing in…">Sign in</SubmitButton>
      </ActionForm>
      <div className="mt-4 text-center text-sm">
        <Link href="/forgot" className="link">Forgot your password?</Link>
      </div>
    </>
  );
}
