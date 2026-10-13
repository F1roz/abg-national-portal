import Link from "next/link";
import { requireActor } from "@/lib/session";
import { lcOf, positionLabels, usersByIds } from "@/lib/org";
import { bodiesOfUser } from "@/lib/access";
import { contributionScores } from "@/lib/leaderboard";
import { Card, PageHeader, Tabs } from "@/components/ui";

export const metadata = { title: "Leaderboard" };

const PERIODS: Record<string, { label: string; days: number }> = { week: { label: "This week", days: 7 }, month: { label: "This month", days: 30 }, term: { label: "Term", days: 365 } };

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ p?: string; by?: string }> }) {
  const { actor, org } = await requireActor();
  const { p = "month", by = "people" } = await searchParams;
  const period = PERIODS[p] ?? PERIODS.month!;
  const users = [...org.userPositions.keys()];
  const scores = await contributionScores(users, new Date(Date.now() - period.days * 86_400_000));
  const people = await usersByIds(scores.slice(0, 50).map((s) => s.userId));
  const lcScores = new Map<string, { name: string; total: number; n: number }>();
  for (const sc of scores) {
    const lc = bodiesOfUser(org, sc.userId).map((b) => lcOf(org, b)).find(Boolean);
    if (!lc) continue;
    const cur = lcScores.get(lc.id) ?? { name: lc.name, total: 0, n: 0 };
    cur.total += sc.score;
    cur.n++;
    lcScores.set(lc.id, cur);
  }
  const lcRank = [...lcScores.entries()].map(([id, v]) => ({ id, ...v, avg: Math.round(v.total / v.n) })).sort((a, b) => b.avg - a.avg);
  const myRank = scores.findIndex((x) => x.userId === actor.id) + 1;

  return (
    <>
      <PageHeader title="🏆 Leaderboard" subtitle="Score = performance + contribution + consistency + culture + learning. Not revenue-only." />
      <Tabs active={p} tabs={Object.entries(PERIODS).map(([k, v]) => ({ key: k, label: v.label, href: `/leaderboard?p=${k}&by=${by}` }))} />
      {myRank ? <p className="mb-4 text-sm">You are <strong>#{myRank}</strong> of {scores.length} nationally for {period.label.toLowerCase()}.</p> : null}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Top contributors" className="lg:col-span-2" bodyClass="p-0">
          <table className="table">
            <thead><tr><th>#</th><th>Person</th><th>Score</th><th>Tasks</th><th>Tracker rows</th><th>Updates</th><th>Recognition</th><th>Learning</th></tr></thead>
            <tbody>
              {scores.slice(0, 25).map((x, i) => (
                <tr key={x.userId} className={x.userId === actor.id ? "bg-brand-soft" : ""}>
                  <td>{i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</td>
                  <td><Link className="link" href={`/people/${x.userId}`}>{people.get(x.userId)?.name}</Link><div className="text-xs text-gray-500">{positionLabels(org, x.userId)[0]}</div></td>
                  <td className="font-bold">{x.score}</td><td>{x.tasks}</td><td>{x.rows}</td><td>{x.updates}</td><td>{x.recognition}</td><td>{x.learning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="LC ranking (average score)">
          <ol className="space-y-2 text-sm">{lcRank.map((l, i) => <li key={l.id} className="flex justify-between"><span>{i + 1}. {l.name}</span><span className="font-semibold">{l.avg}</span></li>)}</ol>
        </Card>
      </div>
    </>
  );
}
