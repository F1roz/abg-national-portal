import Link from "next/link";
import { and, eq, ne } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { bodiesOfUser } from "@/lib/access";
import { lcOf, positionLabels } from "@/lib/org";
import { Avatar, Card, Empty, PageHeader } from "@/components/ui";

export const metadata = { title: "Directory" };

export default async function DirectoryPage({ searchParams }: { searchParams: Promise<{ q?: string; lc?: string; dept?: string; role?: string }> }) {
  const { q = "", lc = "", dept = "", role = "" } = await searchParams;
  const { org } = await requireActor();
  const users = await db.select().from(s.users).where(and(eq(s.users.userType, "internal"), ne(s.users.status, "archived")));
  const lcs = [...org.bodies.values()].filter((b) => b.termId === org.termId && (b.type === "lc" || b.type === "mc"));
  const depts = [...new Set([...org.bodies.values()].filter((b) => b.termId === org.termId).map((b) => b.departmentKey).filter(Boolean))] as string[];
  const rows = users
    .map((u) => {
      const bodies = bodiesOfUser(org, u.id);
      return { u, labels: positionLabels(org, u.id), lcIds: new Set(bodies.map((b) => lcOf(org, b)?.id)), depts: new Set(bodies.flatMap((b) => { const out: string[] = []; let c = org.bodies.get(b); while (c) { if (c.departmentKey) out.push(c.departmentKey); c = c.parentId ? org.bodies.get(c.parentId) : undefined; } return out; })), roles: new Set((org.userPositions.get(u.id) ?? []).map((p) => org.positions.get(p)?.roleKey)) };
    })
    .filter(({ u, labels, lcIds, depts: d, roles }) => {
      const hay = `${u.name} ${u.preferredName ?? ""} ${labels.join(" ")} ${u.skills.join(" ")} ${u.university ?? ""}`.toLowerCase();
      return (!q || hay.includes(q.toLowerCase())) && (!lc || lcIds.has(lc)) && (!dept || d.has(dept)) && (!role || roles.has(role as never));
    })
    .sort((a, b) => (b.labels.length ? 1 : 0) - (a.labels.length ? 1 : 0) || a.u.name.localeCompare(b.u.name));

  return (
    <>
      <PageHeader title="Directory" subtitle={`${rows.length} people`} />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Name, position, skill, university…" className="input max-w-xs" />
        <select name="lc" defaultValue={lc} className="input max-w-[200px]"><option value="">All LCs / MC</option>{lcs.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <select name="dept" defaultValue={dept} className="input max-w-[140px]"><option value="">All depts</option>{depts.map((d) => <option key={d}>{d}</option>)}</select>
        <select name="role" defaultValue={role} className="input max-w-[140px]"><option value="">All roles</option>{["mcp", "mcvp", "lcp", "lcvp", "tl", "member", "ocp", "ocvp", "ecb", "esc", "efb", "est"].map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}</select>
        <button className="btn-secondary">Search</button>
      </form>
      {rows.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ u, labels }) => (
            <Link key={u.id} href={`/people/${u.id}`} className="card flex items-start gap-3 p-4 hover:shadow-md">
              <Avatar name={u.name} src={u.photoUrl} size={44} />
              <div className="min-w-0">
                <div className="font-semibold">{u.name}{u.status === "alumni" ? <span className="ml-1 text-xs text-purple-600">alumni</span> : null}</div>
                <div className="truncate text-sm text-gray-600">{labels[0] ?? "—"}</div>
                {labels.length > 1 ? <div className="truncate text-xs text-gray-400">{labels.slice(1).join(" · ")}</div> : null}
                {u.skills.length ? <div className="mt-1 truncate text-xs text-gray-500">{u.skills.slice(0, 4).join(" · ")}</div> : null}
              </div>
            </Link>
          ))}
        </div>
      ) : <Card><Empty>Nobody matches.</Empty></Card>}
    </>
  );
}
