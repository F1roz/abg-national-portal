import QRCode from "qrcode";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor, mfaRequired } from "@/lib/session";
import { SESSION_COOKIE } from "@/lib/auth";
import { generateSecret, otpauthUrl, verifyTotp } from "@/lib/totp";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton, type FormState } from "@/components/forms";
import { fmtDateTime, sha256, str } from "@/lib/util";
import { changePasswordAction } from "../../(auth)/welcome/actions";

export const metadata = { title: "Security" };

async function startEnrol() {
  "use server";
  const { actor } = await requireActor({ stage: "security" });
  if (actor.user.mfaEnabled) return;
  await db.update(s.users).set({ totpSecret: generateSecret() }).where(eq(s.users.id, actor.id));
  revalidatePath("/security");
}

async function confirmEnrol(_: FormState, form: FormData): Promise<FormState> {
  "use server";
  const { actor } = await requireActor({ stage: "security" });
  const [u] = await db.select().from(s.users).where(eq(s.users.id, actor.id));
  if (!u?.totpSecret || !verifyTotp(u.totpSecret, str(form, "code"))) return { error: "Code didn't match. Make sure your phone's time is correct and try the newest code." };
  await db.update(s.users).set({ mfaEnabled: true }).where(eq(s.users.id, actor.id));
  // The current session has just proven possession of the authenticator.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await db.update(s.sessions).set({ mfaVerified: true }).where(eq(s.sessions.id, sha256(token)));
  await audit(actor.id, "auth.mfa_enabled", { type: "user", id: actor.id });
  await notify([actor.id], { type: "security", priority: "important", title: "Two-step verification turned on", forceEmail: true });
  revalidatePath("/security");
  return { ok: true, message: "Two-step verification is on. 🎉" };
}

async function disableMfa(_: FormState, form: FormData): Promise<FormState> {
  "use server";
  const { actor } = await requireActor({ stage: "security" });
  if (mfaRequired(actor)) return { error: "Two-step verification is mandatory for leadership roles." };
  if (!actor.user.totpSecret || !verifyTotp(actor.user.totpSecret, str(form, "code"))) return { error: "Enter a valid current code to turn it off." };
  await db.update(s.users).set({ mfaEnabled: false, totpSecret: null }).where(eq(s.users.id, actor.id));
  await audit(actor.id, "auth.mfa_disabled", { type: "user", id: actor.id });
  await notify([actor.id], { type: "security", priority: "critical", title: "Two-step verification was turned off", forceEmail: true });
  revalidatePath("/security");
  return { ok: true, message: "Turned off." };
}

async function revoke(form: FormData) {
  "use server";
  const { actor } = await requireActor({ stage: "security" });
  const id = str(form, "id");
  const all = form.get("all") === "1";
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const current = token ? sha256(token) : "";
  const rows = await db.select().from(s.sessions).where(and(eq(s.sessions.userId, actor.id), isNull(s.sessions.revokedAt)));
  for (const r of rows) if ((all && r.id !== current) || r.id === id) await db.update(s.sessions).set({ revokedAt: new Date() }).where(eq(s.sessions.id, r.id));
  await audit(actor.id, "auth.sessions_revoked", { type: "user", id: actor.id }, { all });
  revalidatePath("/security");
}

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ enrol?: string }> }) {
  const { actor } = await requireActor({ stage: "security" });
  const { enrol } = await searchParams;
  const [u] = await db.select().from(s.users).where(eq(s.users.id, actor.id));
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const current = token ? sha256(token) : "";
  const sessions = await db.select().from(s.sessions).where(and(eq(s.sessions.userId, actor.id), isNull(s.sessions.revokedAt), gt(s.sessions.expiresAt, new Date()))).orderBy(desc(s.sessions.lastSeenAt));
  const logins = await db.select().from(s.loginEvents).where(eq(s.loginEvents.userId, actor.id)).orderBy(desc(s.loginEvents.createdAt)).limit(15);
  const required = mfaRequired(actor);
  const qr = u!.totpSecret && !u!.mfaEnabled ? await QRCode.toDataURL(otpauthUrl(u!.totpSecret, u!.email), { width: 220, margin: 1 }) : null;

  return (
    <>
      <PageHeader title="Security & sessions" subtitle="Two-step verification, active devices and sign-in history." />
      {enrol && !u!.mfaEnabled ? <Notice tone="red">Two-step verification is <strong>mandatory</strong> for leadership and admin roles. Set it up to continue to the portal.</Notice> : null}
      <div className="space-y-6">
        <Card title="Two-step verification (authenticator app)" actions={u!.mfaEnabled ? <Badge tone="green">On</Badge> : <Badge tone={required ? "red" : "yellow"}>{required ? "Required" : "Off"}</Badge>}>
          {u!.mfaEnabled ? (
            required ? <p className="text-sm text-gray-600">Enabled and required for your role.</p> : (
              <ActionForm action={disableMfa} className="flex gap-2"><input name="code" placeholder="Current 6-digit code" className="input max-w-xs" /><SubmitButton className="btn-secondary">Turn off</SubmitButton></ActionForm>
            )
          ) : qr ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="Authenticator QR code" className="rounded-lg border" />
                <p className="mt-2 break-all text-xs text-gray-500">Can't scan? Enter this key: <code>{u!.totpSecret}</code></p>
              </div>
              <ActionForm action={confirmEnrol}>
                <p className="text-sm">1. Scan with Google Authenticator, Microsoft Authenticator, Authy or 1Password.<br />2. Enter the 6-digit code it shows.</p>
                <input name="code" inputMode="numeric" placeholder="123456" className="input text-center text-lg tracking-widest" />
                <SubmitButton>Verify & turn on</SubmitButton>
              </ActionForm>
            </div>
          ) : (
            <form action={startEnrol}><p className="mb-3 text-sm text-gray-600">Protect your account with a code from your phone in addition to your password.</p><SubmitButton>Set up two-step verification</SubmitButton></form>
          )}
        </Card>
        <Card title="Change password">
          <ActionForm action={changePasswordAction} resetOnSuccess className="grid gap-2 sm:grid-cols-3">
            <input name="current" type="password" placeholder="Current password" className="input" autoComplete="current-password" />
            <input name="password" type="password" placeholder="New password" className="input" autoComplete="new-password" />
            <input name="confirm" type="password" placeholder="Repeat new password" className="input" autoComplete="new-password" />
            <div className="sm:col-span-3"><SubmitButton className="btn-secondary">Change password</SubmitButton></div>
          </ActionForm>
        </Card>
        <Card title={`Active sessions (${sessions.length})`} actions={sessions.length > 1 ? <form action={revoke}><input type="hidden" name="all" value="1" /><SubmitButton className="btn-secondary btn-sm">Sign out all other devices</SubmitButton></form> : null} bodyClass="p-0">
          <table className="table">
            <thead><tr><th>Device</th><th>IP</th><th>Last active</th><th /></tr></thead>
            <tbody>{sessions.map((x) => (
              <tr key={x.id}><td className="max-w-xs truncate text-xs">{x.userAgent ?? "Unknown"}{x.id === current ? <Badge tone="green">this device</Badge> : null}</td><td className="text-xs">{x.ip ?? "—"}</td><td className="text-xs">{fmtDateTime(x.lastSeenAt)}</td>
                <td>{x.id !== current ? <form action={revoke}><input type="hidden" name="id" value={x.id} /><SubmitButton className="btn-ghost btn-sm">Sign out</SubmitButton></form> : null}</td></tr>
            ))}</tbody>
          </table>
        </Card>
        <Card title="Recent sign-in activity" bodyClass="p-0">
          <table className="table">
            <thead><tr><th>When</th><th>Result</th><th>IP</th><th>Device</th></tr></thead>
            <tbody>{logins.map((l) => <tr key={l.id}><td className="text-xs">{fmtDateTime(l.createdAt)}</td><td>{l.success ? <Badge tone="green">success</Badge> : <Badge tone="red">{l.reason ?? "failed"}</Badge>}</td><td className="text-xs">{l.ip ?? "—"}</td><td className="max-w-xs truncate text-xs">{l.userAgent}</td></tr>)}</tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
