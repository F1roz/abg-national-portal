import { createHash, randomBytes } from "node:crypto";

export const APP_TZ = process.env.APP_TIMEZONE ?? "Asia/Dhaka";
export const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Cryptographically secure, URL-safe token (256 bits by default). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** YYYY-MM-DD in the portal's timezone. */
export function localDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Interpret "YYYY-MM-DDTHH:mm" typed in a form as portal-local time. */
export function parseLocalDateTime(value: string): Date | null {
  if (!value) return null;
  const [datePart, timePart = "23:59"] = value.split("T");
  const offset = tzOffsetMinutes(new Date(`${datePart}T12:00:00Z`));
  const utc = new Date(`${datePart}T${timePart}:00Z`);
  if (Number.isNaN(utc.getTime())) return null;
  return new Date(utc.getTime() - offset * 60_000);
}

/** Offset of APP_TZ from UTC in minutes at the given instant (Dhaka = +360). */
export function tzOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

export function toLocalInput(d: Date | null | undefined): string {
  if (!d) return "";
  const shifted = new Date(d.getTime() + tzOffsetMinutes(d) * 60_000);
  return shifted.toISOString().slice(0, 16);
}

export function fmtDate(d: Date | string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d) : d;
  return new Intl.DateTimeFormat("en-GB", { timeZone: typeof d === "string" && d.length === 10 ? "UTC" : APP_TZ, ...opts }).format(date);
}

export function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: APP_TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}

export function relTime(d: Date): string {
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  return rtf.format(Math.round(diff / 86_400_000), "day");
}

export function pct(actual: number, target: number): number {
  if (!target) return 0;
  return Math.round((actual / target) * 100);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function optStr(form: FormData, key: string): string | null {
  return str(form, key) || null;
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}
