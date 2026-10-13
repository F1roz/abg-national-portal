import Link from "next/link";
import { requireActor } from "@/lib/session";
import { bodyPath, usersByIds } from "@/lib/org";
import { Card, Empty, PageHeader } from "@/components/ui";
import { db, s } from "@/db";
import { eq } from "drizzle-orm";

export const metadata = { title: "My position" };

export default async function MyPosition() {
  const { actor, org } = await requireActor();
  const [term] = await db.select().from(s.terms).where(eq(s.terms.id, org.termId));
  const supIds = actor.positions.flatMap((p) => (p.position.reportsToId ? org.holders.get(p.position.reportsToId) ?? [] : []));
  const sups = await usersByIds(supIds);
  if (!actor.positions.length) return <Card><Empty>You have no active position this term.</Empty></Card>;
  return (
    <>
      <PageHeader title="My position" subtitle={`Your official job description(s) for term ${term?.code}.`} />
      <div className="space-y-6">
        {actor.positions.map(({ position: p, body }) => {
          const jd = p.jd;
          const sup = p.reportsToId ? org.positions.get(p.reportsToId) : undefined;
          return (
            <Card key={p.id} title={`${p.title} — ${body.name}`}>
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-3 text-sm">
                  {jd.purpose ? <div><div className="label">Purpose</div><p>{jd.purpose}</p></div> : null}
                  <div><div className="label">Reporting line</div><p>{sup ? `${sup.title} — ${(org.holders.get(sup.id) ?? []).map((u) => sups.get(u)?.name).join(", ") || "vacant"}` : "Top of the structure"}</p></div>
                  <div><div className="label">Body</div><p><Link className="link" href={`/bodies/${body.id}`}>{bodyPath(org, body.id) || body.name}</Link></p></div>
                  <div><div className="label">Term</div><p>{term?.code} ({term?.startsOn} → {term?.endsOn})</p></div>
                  {jd.workingRhythm ? <div><div className="label">Working rhythm</div><p>{jd.workingRhythm}</p></div> : null}
                </div>
                <div className="space-y-3 text-sm">
                  {[["Responsibilities", jd.responsibilities], ["KPIs", jd.kpis], ["Deliverables", jd.deliverables], ["Authorities", jd.authorities], ["Evaluation criteria", jd.evaluationCriteria]].map(([h, list]) =>
                    (list as string[] | undefined)?.length ? <div key={h as string}><div className="label">{h as string}</div><ul className="list-disc pl-5">{(list as string[]).map((x) => <li key={x}>{x}</li>)}</ul></div> : null,
                  )}
                  {jd.competencies?.length ? <div><div className="label">Competencies (required level 1–5)</div><ul>{jd.competencies.map((c) => <li key={c.name} className="flex justify-between"><span>{c.name}</span><span>{"●".repeat(c.level)}{"○".repeat(5 - c.level)}</span></li>)}</ul></div> : null}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
