import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, s } from "@/db";
import { AUDIENCES } from "@/db/schema";
import { requireActor } from "@/lib/session";
import { inAudience } from "@/lib/access";
import { positionLabels, usersByIds } from "@/lib/org";
import { Avatar, Badge, Card, Empty, PageHeader, Tabs } from "@/components/ui";
import { ActionForm, SubmitButton, type FormState } from "@/components/forms";
import { escapeHtml, optStr, relTime, str } from "@/lib/util";

export const metadata = { title: "Newsfeed" };

async function createPost(_: FormState, form: FormData): Promise<FormState> {
  "use server";
  const { actor, org } = await requireActor();
  const body = str(form, "body");
  if (!body) return { error: "Write something first." };
  const audience = str(form, "audience") as (typeof AUDIENCES)[number];
  const bodyId = optStr(form, "bodyId");
  if (!AUDIENCES.includes(audience)) return { error: "Choose an audience." };
  // Anyone can post internally; only MC can make a post visible to partners / BOA.
  if (audience === "external" && !actor.isMC) return { error: "Only the MC can publish to external audiences." };
  if ((audience === "body" || audience === "leadership") && (!bodyId || !inAudience(actor, org, "body", bodyId))) return { error: "Choose a body you belong to." };
  const link = optStr(form, "linkUrl");
  await db.insert(s.posts).values({ authorId: actor.id, body: body.slice(0, 5000), kind: (["update", "achievement", "opportunity", "event", "knowledge"].includes(str(form, "kind")) ? str(form, "kind") : "update") as "update", audience, bodyId: audience === "national" || audience === "external" ? null : bodyId, linkUrl: link && /^https:\/\//.test(link) ? link : null });
  revalidatePath("/newsfeed");
  return { ok: true, message: "Posted." };
}

async function react(form: FormData) {
  "use server";
  const { actor } = await requireActor();
  const postId = str(form, "postId");
  const kind = str(form, "kind") === "celebrate" ? "celebrate" : "like";
  const where = and(eq(s.postReactions.postId, postId), eq(s.postReactions.userId, actor.id), eq(s.postReactions.kind, kind));
  const removed = await db.delete(s.postReactions).where(where).returning();
  if (!removed.length) await db.insert(s.postReactions).values({ postId, userId: actor.id, kind }).onConflictDoNothing();
  revalidatePath("/newsfeed");
}

async function comment(_: FormState, form: FormData): Promise<FormState> {
  "use server";
  const { actor } = await requireActor();
  const body = str(form, "body");
  if (!body) return { error: "Empty comment." };
  await db.insert(s.postComments).values({ postId: str(form, "postId"), authorId: actor.id, body: body.slice(0, 2000) });
  revalidatePath("/newsfeed");
  return { ok: true };
}

/** Render @mentions and #tags as links (text is escaped first). */
function richText(text: string) {
  const html = escapeHtml(text).replace(/(^|\s)#(\w+)/g, '$1<a class="link" href="/newsfeed?tag=$2">#$2</a>');
  return <p className="whitespace-pre-wrap text-sm text-gray-800" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default async function Newsfeed({ searchParams }: { searchParams: Promise<{ f?: string; tag?: string }> }) {
  const { actor, org } = await requireActor();
  const { f = "all", tag } = await searchParams;
  const all = await db.select().from(s.posts).orderBy(desc(s.posts.createdAt)).limit(200);
  let posts = all.filter((p) => inAudience(actor, org, p.audience, p.bodyId));
  if (f === "national") posts = posts.filter((p) => p.audience === "national");
  if (f === "mine") posts = posts.filter((p) => p.bodyId && [...actor.memberBodyIds].some((b) => b === p.bodyId));
  if (["achievement", "opportunity", "knowledge", "event"].includes(f)) posts = posts.filter((p) => p.kind === f);
  if (tag) posts = posts.filter((p) => p.body.toLowerCase().includes(`#${tag.toLowerCase()}`));
  posts = posts.slice(0, 50);
  const ids = posts.map((p) => p.id);
  const [reactions, comments] = ids.length ? await Promise.all([
    db.select().from(s.postReactions).where(inArray(s.postReactions.postId, ids)),
    db.select().from(s.postComments).where(inArray(s.postComments.postId, ids)).orderBy(asc(s.postComments.createdAt)),
  ]) : [[], []];
  const people = await usersByIds([...posts.map((p) => p.authorId), ...comments.map((c) => c.authorId)]);
  const myBodies = [...actor.memberBodyIds].map((b) => org.bodies.get(b)!).filter(Boolean);

  return (
    <>
      <PageHeader title="📰 Newsfeed" subtitle="Share wins, opportunities and knowledge. Choose who sees each post — partners and BOA never see internal posts." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <ActionForm action={createPost} resetOnSuccess>
              <textarea name="body" rows={3} className="input" placeholder="Share an update, celebrate someone, post an opportunity… use #tags" />
              <div className="flex flex-wrap gap-2">
                <select name="kind" className="input max-w-[150px]"><option value="update">Update</option><option value="achievement">🏆 Achievement</option><option value="opportunity">🌍 Opportunity</option><option value="knowledge">🧠 Knowledge</option><option value="event">📅 Event</option></select>
                <select name="audience" className="input max-w-[170px]" defaultValue="national"><option value="national">National (internal)</option><option value="body">My body only</option><option value="leadership">Leadership of body</option>{actor.isMC ? <option value="external">External (partners/BOA)</option> : null}</select>
                <select name="bodyId" className="input max-w-[200px]">{myBodies.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                <input name="linkUrl" placeholder="https:// link (optional)" className="input max-w-[220px]" />
                <SubmitButton>Post</SubmitButton>
              </div>
            </ActionForm>
          </Card>
          <Tabs active={f} tabs={["all", "national", "mine", "achievement", "opportunity", "knowledge", "event"].map((k) => ({ key: k, label: k === "mine" ? "My bodies" : k[0]!.toUpperCase() + k.slice(1), href: `/newsfeed?f=${k}` }))} />
          {tag ? <p className="text-sm">Showing <strong>#{tag}</strong> · <Link className="link" href="/newsfeed">clear</Link></p> : null}
          {posts.length ? posts.map((p) => {
            const r = reactions.filter((x) => x.postId === p.id);
            const cs = comments.filter((c) => c.postId === p.id);
            return (
              <Card key={p.id}>
                <div className="mb-2 flex items-center gap-2">
                  <Avatar name={people.get(p.authorId)?.name ?? "?"} size={36} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/people/${p.authorId}`} className="font-semibold hover:underline">{people.get(p.authorId)?.name}</Link>
                    <div className="text-xs text-gray-500">{positionLabels(org, p.authorId)[0]} · {relTime(p.createdAt)}</div>
                  </div>
                  {p.kind !== "update" ? <Badge tone="purple">{p.kind}</Badge> : null}
                  <Badge>{p.audience === "body" ? org.bodies.get(p.bodyId!)?.shortName ?? "Body" : p.audience}</Badge>
                </div>
                {richText(p.body)}
                {p.linkUrl ? <a href={p.linkUrl} className="link mt-1 block text-sm" target="_blank" rel="noreferrer noopener">{p.linkUrl}</a> : null}
                <div className="mt-3 flex gap-2">
                  {(["like", "celebrate"] as const).map((k) => (
                    <form key={k} action={react}><input type="hidden" name="postId" value={p.id} /><input type="hidden" name="kind" value={k} />
                      <button className={`btn-ghost btn-sm ${r.some((x) => x.kind === k && x.userId === actor.id) ? "bg-brand-soft text-brand" : ""}`}>{k === "like" ? "❤️" : "👏"} {r.filter((x) => x.kind === k).length}</button>
                    </form>
                  ))}
                  <span className="btn-ghost btn-sm">💬 {cs.length}</span>
                </div>
                {cs.length ? <ul className="mt-2 space-y-1 border-t border-gray-100 pt-2 text-sm">{cs.map((c) => <li key={c.id}><strong>{people.get(c.authorId)?.name}</strong> {c.body}</li>)}</ul> : null}
                <ActionForm action={comment} resetOnSuccess className="mt-2 flex gap-2"><input type="hidden" name="postId" value={p.id} /><input name="body" placeholder="Comment…" className="input" /><SubmitButton className="btn-secondary btn-sm">Send</SubmitButton></ActionForm>
              </Card>
            );
          }) : <Card><Empty>No posts yet.</Empty></Card>}
        </div>
        <Card title="Trending tags" className="h-fit">
          <div className="flex flex-wrap gap-1.5">
            {[...new Set(all.flatMap((p) => p.body.match(/#\w+/g) ?? []))].slice(0, 20).map((t) => <Link key={t} href={`/newsfeed?tag=${t.slice(1)}`} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">{t}</Link>)}
          </div>
        </Card>
      </div>
    </>
  );
}
