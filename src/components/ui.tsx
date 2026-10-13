import Link from "next/link";
import { initials, titleCase } from "@/lib/util";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-gray-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, actions, children, className = "", bodyClass = "p-4" }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`card ${className}`}>
      {title ? (
        <header className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
          {actions}
        </header>
      ) : null}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

const TONES = {
  gray: "bg-gray-100 text-gray-700",
  blue: "bg-blue-50 text-blue-700",
  green: "bg-green-50 text-green-700",
  yellow: "bg-amber-50 text-amber-700",
  orange: "bg-orange-50 text-orange-700",
  red: "bg-red-50 text-red-700",
  purple: "bg-purple-50 text-purple-700",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ children, tone = "gray" }: { children: React.ReactNode; tone?: Tone }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  not_started: "gray", in_progress: "blue", blocked: "orange", submitted: "purple", completed: "green", rejected: "red",
  pending: "yellow", approved: "green", cancelled: "gray", open: "blue", passed: "green", no_quorum: "gray",
  active: "green", closed: "gray", planning: "yellow", alumni: "purple", suspended: "red", pending_first_login: "yellow", candidate: "yellow", archived: "gray",
  submitted_idea: "gray", review: "yellow", accepted: "green", pilot: "blue", implemented: "green", scaled: "purple", declined: "red",
  draft: "gray", done: "green", reversed: "red",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "gray"}>{titleCase(status)}</Badge>;
}

const PRIORITY: Record<string, { tone: Tone; label: string }> = {
  critical: { tone: "red", label: "🔴 Critical" },
  high: { tone: "orange", label: "🟠 High" },
  important: { tone: "orange", label: "🟠 Important" },
  medium: { tone: "yellow", label: "🟡 Medium" },
  normal: { tone: "yellow", label: "🟡 Normal" },
  low: { tone: "blue", label: "🔵 Low" },
  info: { tone: "blue", label: "🔵 Info" },
};

export function PriorityBadge({ priority }: { priority: string }) {
  const p = PRIORITY[priority] ?? { tone: "gray" as Tone, label: priority };
  return <Badge tone={p.tone}>{p.label}</Badge>;
}

export function Stat({ label, value, hint, tone, href }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "red" | "green" | "yellow" | "blue"; href?: string }) {
  const color = tone === "red" ? "text-red-600" : tone === "green" ? "text-green-600" : tone === "yellow" ? "text-amber-600" : tone === "blue" ? "text-brand" : "text-gray-900";
  const inner = (
    <div className="card h-full p-4 transition hover:shadow-md">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-gray-500">{hint}</div> : null}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function Progress({ value, max = 100, tone }: { value: number; max?: number; tone?: "auto" | "brand" }) {
  const pctv = max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const color = tone === "brand" ? "bg-brand" : pctv >= 90 ? "bg-green-500" : pctv >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={Math.round(pctv)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pctv}%` }} />
    </div>
  );
}

export function Avatar({ name, src, size = 32 }: { name: string; src?: string | null; size?: number }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials(name)}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">{children}</div>;
}

export function Health({ score }: { score: number | null }) {
  if (score === null) return <span className="text-gray-400">—</span>;
  const dot = score >= 85 ? "🟢" : score >= 65 ? "🟡" : "🔴";
  return (
    <span className="font-semibold">
      {dot} {score}
    </span>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-gray-400">{hint}</span> : null}
    </label>
  );
}

export function Notice({ tone = "blue", children }: { tone?: "blue" | "red" | "yellow" | "green"; children: React.ReactNode }) {
  const cls = { blue: "border-blue-200 bg-blue-50 text-blue-800", red: "border-red-200 bg-red-50 text-red-800", yellow: "border-amber-200 bg-amber-50 text-amber-800", green: "border-green-200 bg-green-50 text-green-800" }[tone];
  return <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <nav className="mb-4 flex flex-wrap gap-1 border-b border-gray-200">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${t.key === active ? "border-brand text-brand" : "border-transparent text-gray-500 hover:text-gray-800"}`}
        >
          {t.label}
          {t.count !== undefined ? <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 text-xs text-gray-600">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
