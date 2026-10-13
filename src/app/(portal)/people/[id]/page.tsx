import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { db, s } from "@/db";
import { requireActor } from "@/lib/session";
import { canAssignTaskTo, canSeeField, canViewReviewsOf } from "@/lib/access";
import { positionLabels, usersByIds } from "@/lib/org";
import { Avatar, Badge, Card, Empty } from "@/components/ui";
import { fmtDate } from "@/lib/util";

export const metadata = { title: "Profile" };

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, org } = await requireActor();
  const [u] = await db.select().from(s.users).where(eq(s.users.id, id));
  if (!u || (u.userType !== "internal" && u.userType !== "alumni" && actor.id !== id)) notFound();

  const history = await db.select().from(s.assignments).where(eq(s.assignments.userId, id)).orderBy(desc(s.assignments.createdAt));
  const posIds = history.map((h) => h.positionId);
  const posRows = posIds.length ? await db.select().from(s.positions).where(inArray(s.positions.id, posIds)) : [];
  const terms = new Map((await db.select().from(s.terms)).map((t) => [t.id, t]));
  const journey = history
    .map((h) => {
      const p = posRows.find((x) => x.id === h.positionId)!;
      const b = org.bodies.get(p.bodyId);
      return { term: terms.get(h.termId), title: p.title, body: b, active: h.active };
    })
    .sort((a, b) => (b.term?.startsOn ?? "").localeCompare(a.term?.startsOn ?? ""));
  const recog = await db.select().from(s.recognitions).where(eq(s.recognitions.toId, id)).orderBy(desc(s.recognitions.createdAt)).limit(20);
  const givers = await usersByIds(recog.map((r) => r.fromId));
  const labels = positionLabels(org, id);
  const showPhone = u.phone && canSeeField(actor, org, id, u.phoneVisibility);
  const showEmail = u.personalEmail && canSeeField(actor, org, id, u.personalEmailVisibility);
  const showBirthday = u.birthday && canSeeField(actor, org, id, u.birthdayVisibility);
  const showEmergency = u.emergencyContact && canSeeField(actor, org, id, "restricted");
  const badges = [...new Set(recog.map((r) => r.badge).filter(Boolean))];
  const waNumber = u.phone?.replace(/[^\d]/g, "");

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6">
        <Card>
          <div className="flex flex-col items-center text-center">
            <Avatar name={u.name} src={u.photoUrl} size={88} />
            <h1 className="mt-3 text-xl font-bold">{u.name}</h1>
            {u.preferredName ? <div className="text-sm text-gray-500">“{u.preferredName}”</div> : null}
            <div className="mt-1 text-sm text-gray-700">{labels.join(" · ") || (u.status === "alumni" ? "Alumni" : "No active position")}</div>
            {badges.length ? <div className="mt-2 flex flex-wrap justify-center gap-1">{badges.map((b) => <Badge key={b} tone="yellow">🏅 {b}</Badge>)}</div> : null}
          </div>
          <dl className="mt-4 space-y-2 text-sm">
            <div><dt className="label">Portal email</dt><dd>{u.email}</dd></div>
            {u.university ? <div><dt className="label">University</dt><dd>{u.university}</dd></div> : null}
            {showPhone ? <div><dt className="label">Phone</dt><dd>{u.phone}</dd></div> : null}
            {showEmail ? <div><dt className="label">Personal email</dt><dd>{u.personalEmail}</dd></div> : null}
            {showBirthday ? <div><dt className="label">Birthday</dt><dd>{fmtDate(u.birthday, { day: "numeric", month: "long" })}</dd></div> : null}
            {showEmergency ? <div><dt className="label">Emergency contact</dt><dd>{u.emergencyContact}</dd></div> : null}
            {u.joinedAt ? <div><dt className="label">Joined AIESEC</dt><dd>{fmtDate(u.joinedAt)}</dd></div> : null}
            {u.skills.length ? <div><dt className="label">Skills</dt><dd>{u.skills.join(", ")}</dd></div> : null}
            {u.languages.length ? <div><dt className="label">Languages</dt><dd>{u.languages.join(", ")}</dd></div> : null}
            {u.linkedin ? <div><dt className="label">LinkedIn</dt><dd><a className="link" href={u.linkedin} target="_blank" rel="noreferrer noopener">Profile ↗</a></dd></div> : null}
          </dl>
        </Card>
        {actor.id !== id ? (
          <Card title={`Connect with ${u.preferredName ?? u.name.split(" ")[0]}`}>
            <div className="flex flex-col gap-2">
              {showPhone && waNumber ? <a className="btn-secondary" href={`https://wa.me/${waNumber}`} target="_blank" rel="noreferrer noopener">💬 WhatsApp</a> : null}
              <a className="btn-secondary" href={`mailto:${u.email}`}>📧 Email</a>
              {canAssignTaskTo(actor, org, id) ? <Link className="btn-secondary" href={`/tasks/new?assignee=${id}`}>➕ Assign a task</Link> : null}
              <Link className="btn-secondary" href={`/recognition?to=${id}`}>👏 Recognise</Link>
              {canViewReviewsOf(actor, org, id) ? <Link className="btn-secondary" href={`/reviews/${id}`}>📝 Reviews</Link> : null}
            </div>
            <p className="mt-3 text-xs text-gray-400">WhatsApp group access is requested from the group&apos;s admin — the portal never adds people to groups automatically.</p>
          </Card>
        ) : (
          <Card><Link href="/profile" className="btn-secondary w-full">Edit my profile & privacy</Link></Card>
        )}
      </div>
      <div className="space-y-6 lg:col-span-2">
        {u.bio ? <Card title="About"><p className="whitespace-pre-wrap text-sm">{u.bio}</p></Card> : null}
        <Card title="AIESEC journey">
          {journey.length ? (
            <ol className="relative space-y-4 border-l-2 border-brand/30 pl-5">
              {journey.map((j, i) => (
                <li key={i}>
                  <span className={`absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full ${j.active ? "bg-brand" : "bg-gray-300"}`} />
                  <div className="text-xs font-semibold text-gray-500">{j.term?.code}{j.active ? " · current" : ""}</div>
                  <div className="font-semibold">{j.title}</div>
                  {j.body ? <Link href={`/bodies/${j.body.id}`} className="text-sm text-gray-600 hover:underline">{j.body.name}</Link> : null}
                </li>
              ))}
            </ol>
          ) : <Empty>No positions recorded yet.</Empty>}
        </Card>
        <Card title={`Recognition (${recog.length})`}>
          {recog.length ? (
            <ul className="space-y-3 text-sm">
              {recog.map((r) => (<li key={r.id}>👏 “{r.message}”<div className="text-xs text-gray-500">— {givers.get(r.fromId)?.name} · {fmtDate(r.createdAt)}{r.badge ? ` · 🏅 ${r.badge}` : ""}</div></li>))}
            </ul>
          ) : <Empty>No recognition yet.</Empty>}
        </Card>
      </div>
    </div>
  );
}
