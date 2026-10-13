import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, s } from "@/db";
import { ActionForm, SubmitButton, type FormState } from "@/components/forms";
import { issueUserToken } from "@/lib/tokens";
import { emailLayout, queueEmail } from "@/lib/email";
import { audit } from "@/lib/audit";
import { APP_URL, escapeHtml, str } from "@/lib/util";

export const metadata = { title: "Reset password" };

async function requestReset(_: FormState, form: FormData): Promise<FormState> {
  "use server";
  const email = str(form, "email").toLowerCase();
  const [user] = await db.select().from(s.users).where(eq(s.users.email, email)).limit(1);
  if (user && ["active", "pending_first_login"].includes(user.status)) {
    const token = await issueUserToken(user.id, "password_reset", 1);
    await queueEmail(user.email, "Reset your AIESEC Bangladesh Portal password", emailLayout({
      title: "Reset your password",
      contentHtml: `<p>Hi ${escapeHtml(user.preferredName ?? user.name)},</p><p>Someone (hopefully you) asked to reset your portal password. The link below works once and expires in 1 hour.</p><p>If you didn't ask for this, ignore this email — your password stays the same.</p>`,
      cta: { label: "Set a new password", url: `${APP_URL}/activate/${token}` },
    }));
    await audit(user.id, "auth.password_reset_requested", { type: "user", id: user.id });
  }
  // Same answer whether or not the account exists (no account enumeration).
  return { ok: true, message: "If that email has a portal account, a reset link is on its way." };
}

export default function ForgotPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-bold">Reset your password</h1>
      <p className="mb-4 text-sm text-gray-500">We'll email you a one-time link.</p>
      <ActionForm action={requestReset}>
        <input name="email" type="email" required placeholder="you@example.org" className="input" />
        <SubmitButton className="btn-primary w-full" pendingText="Sending…">Send reset link</SubmitButton>
      </ActionForm>
      <div className="mt-4 text-center text-sm"><Link href="/login" className="link">Back to sign in</Link></div>
    </>
  );
}
