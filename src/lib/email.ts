import { eq } from "drizzle-orm";
import { db, s } from "@/db";
import { APP_URL, escapeHtml } from "./util";

const BRAND = "#037ef3"; // AIESEC blue

/** Responsive, table-based HTML email with the portal branding. `contentHtml` must already be escaped/safe. */
export function emailLayout(opts: { title: string; contentHtml: string; cta?: { label: string; url: string }; footerNote?: string }): string {
  const cta = opts.cta
    ? `<tr><td align="center" style="padding:8px 32px 28px"><a href="${escapeHtml(opts.cta.url)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:600;padding:14px 28px;border-radius:8px;font-size:15px">${escapeHtml(opts.cta.label)}</a></td></tr>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(opts.title)}</title></head>
<body style="margin:0;background:#f3f5f9;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:${BRAND};padding:22px 32px;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.2px">AIESEC in Bangladesh</td></tr>
<tr><td style="padding:28px 32px 8px;font-size:15px;line-height:1.6">${opts.contentHtml}</td></tr>
${cta}
<tr><td style="padding:18px 32px;background:#f9fafb;color:#6b7280;font-size:12px;line-height:1.5">${opts.footerNote ? `${escapeHtml(opts.footerNote)}<br>` : ""}This message was sent by the AIESEC in Bangladesh National Portal. <a href="${APP_URL}" style="color:${BRAND}">${escapeHtml(APP_URL)}</a></td></tr>
</table></td></tr></table></body></html>`;
}

export async function queueEmail(to: string, subject: string, html: string): Promise<void> {
  await db.insert(s.emailOutbox).values({ to, subject, html });
}

/**
 * Delivers queued emails. With SMTP configured they are sent; otherwise they are marked "logged"
 * and can be read in Admin → Email outbox (useful in development and before SMTP is set up).
 */
export async function deliverOutbox(limit = 50): Promise<{ sent: number; logged: number; failed: number }> {
  const queued = await db.select().from(s.emailOutbox).where(eq(s.emailOutbox.status, "queued")).limit(limit);
  const result = { sent: 0, logged: 0, failed: 0 };
  if (!queued.length) return result;
  if (!process.env.SMTP_HOST) {
    for (const m of queued) await db.update(s.emailOutbox).set({ status: "logged" }).where(eq(s.emailOutbox.id, m.id));
    result.logged = queued.length;
    return result;
  }
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  for (const m of queued) {
    try {
      await transport.sendMail({ from: process.env.SMTP_FROM, to: m.to, subject: m.subject, html: m.html });
      await db.update(s.emailOutbox).set({ status: "sent", sentAt: new Date() }).where(eq(s.emailOutbox.id, m.id));
      result.sent++;
    } catch (e) {
      await db.update(s.emailOutbox).set({ status: "failed", error: String(e).slice(0, 500) }).where(eq(s.emailOutbox.id, m.id));
      result.failed++;
    }
  }
  return result;
}
