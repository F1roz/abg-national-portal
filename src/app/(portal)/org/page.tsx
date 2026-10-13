import Link from "next/link";
import { requireActor } from "@/lib/session";
import { rootOf, type Org } from "@/lib/access";
import { usersByIds } from "@/lib/org";
import { Badge, PageHeader } from "@/components/ui";

export const metadata = { title: "Structure" };

const ORDER = ["mc", "department", "support", "governance", "lc", "team", "oc", "project", "synergy"];

function Node({ org, id, names, depth }: { org: Org; id: string; names: Map<string, string>; depth: number }) {
  const b = org.bodies.get(id)!;
  const kids = (org.children.get(id) ?? []).map((c) => org.bodies.get(c)!).sort((a, z) => ORDER.indexOf(a.type) - ORDER.indexOf(z.type) || a.name.localeCompare(z.name));
  const leaders = [...org.positions.values()].filter((p) => p.bodyId === id && (p.isLeader || ["est", "ecb", "esc", "efb", "ocvp"].includes(p.roleKey))).sort((a, z) => a.sortOrder - z.sortOrder);
  const members = [...org.positions.values()].filter((p) => p.bodyId === id && !p.isLeader).reduce((n, p) => n + (org.holders.get(p.id)?.length ?? 0), 0);
  const label = (
    <span className="flex flex-wrap items-center gap-2">
      <Link href={`/bodies/${id}`} className="font-semibold hover:underline">{b.name}</Link>
      <Badge tone={b.type === "governance" ? "red" : b.type === "oc" ? "orange" : b.type === "synergy" || b.type === "project" ? "purple" : "blue"}>{b.type}</Badge>
      {leaders.map((p) => (
        <span key={p.id} className="text-xs text-gray-600">
          {p.title}: {(org.holders.get(p.id) ?? []).map((u) => <Link key={u} href={`/people/${u}`} className="link">{names.get(u)}</Link>).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ", ", el] : [el]), []) || <em className="text-gray-400">vacant</em>}
        </span>
      ))}
      {members ? <span className="text-xs text-gray-400">+{members} members</span> : null}
    </span>
  );
  if (!kids.length) return <li className="py-1">{label}</li>;
  return (
    <li className="py-1">
      <details open={depth < 2}>
        <summary className="cursor-pointer list-none">{label}</summary>
        <ul className="ml-4 border-l border-gray-200 pl-4">{kids.map((k) => <Node key={k.id} org={org} id={k.id} names={names} depth={depth + 1} />)}</ul>
      </details>
    </li>
  );
}

export default async function OrgPage() {
  const { org } = await requireActor();
  const root = rootOf(org, org.termId);
  const names = new Map([...(await usersByIds([...org.userPositions.keys()])).values()].map((u) => [u.id, u.name]));
  return (
    <>
      <PageHeader title="Organisation structure" subtitle="Defined as data: bodies, positions and reporting lines can change every term without code changes." />
      <div className="card p-4">
        {root ? <ul><Node org={org} id={root.id} names={names} depth={0} /></ul> : <p>No structure for the current term yet.</p>}
      </div>
    </>
  );
}
