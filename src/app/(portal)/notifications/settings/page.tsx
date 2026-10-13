import { eq } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { NOTIFICATION_TYPES } from "@/lib/notify";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton, type FormState } from "@/components/forms";

export const metadata = { title: "Notification settings" };

async function save(_: FormState, form: FormData): Promise<FormState> {
  "use server";
  const { actor } = await requireActor();
  for (const type of Object.keys(NOTIFICATION_TYPES)) {
    if (type === "security") continue;
    const email = form.get(`email_${type}`) === "on";
    await db.insert(s.notificationPrefs).values({ userId: actor.id, type, email }).onConflictDoUpdate({ target: [s.notificationPrefs.userId, s.notificationPrefs.type], set: { email } });
  }
  return { ok: true, message: "Preferences saved." };
}

export default async function NotificationSettings() {
  const { actor } = await requireActor();
  const prefs = new Map((await db.select().from(s.notificationPrefs).where(eq(s.notificationPrefs.userId, actor.id))).map((p) => [p.type, p.email]));
  return (
    <>
      <PageHeader title="Notification settings" subtitle="Portal notifications are always on. Choose which ones also reach your email. Critical alerts and security notices are always emailed." />
      <Card className="max-w-2xl">
        <ActionForm action={save}>
          <table className="table">
            <thead><tr><th>Notification</th><th>Portal</th><th>Email</th></tr></thead>
            <tbody>
              {Object.entries(NOTIFICATION_TYPES).map(([k, v]) => (
                <tr key={k}><td>{v.label}</td><td>✅</td><td>{k === "security" ? "✅ always" : <input type="checkbox" name={`email_${k}`} defaultChecked={prefs.get(k) ?? v.emailDefault} />}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-400">Phone push notifications (Web Push) and WhatsApp delivery are planned integrations — today notifications reach you in the portal and by email.</p>
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
