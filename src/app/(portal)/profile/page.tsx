import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, s } from "@/db";
import { VISIBILITY } from "@/db/schema";
import { requireActor } from "@/lib/session";
import { audit } from "@/lib/audit";
import { Card, Field, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton, type FormState } from "@/components/forms";
import { str } from "@/lib/util";

export const metadata = { title: "Edit profile" };

async function saveProfile(_: FormState, form: FormData): Promise<FormState> {
  "use server";
  const { actor } = await requireActor();
  const vis = (k: string) => ((VISIBILITY as readonly string[]).includes(str(form, k)) ? str(form, k) : "restricted") as (typeof VISIBILITY)[number];
  const list = (k: string) => str(form, k).split(",").map((x) => x.trim()).filter(Boolean).slice(0, 20);
  const url = (k: string) => (/^https:\/\//.test(str(form, k)) ? str(form, k) : null);
  if (!str(form, "name")) return { error: "Name is required." };
  await db
    .update(s.users)
    .set({
      name: str(form, "name"), preferredName: str(form, "preferredName") || null, phone: str(form, "phone") || null, personalEmail: str(form, "personalEmail") || null,
      birthday: str(form, "birthday") || null, emergencyContact: str(form, "emergencyContact") || null, university: str(form, "university") || null,
      location: str(form, "location") || null, bio: str(form, "bio").slice(0, 2000) || null, linkedin: url("linkedin"), portfolio: url("portfolio"), photoUrl: url("photoUrl"),
      skills: list("skills"), languages: list("languages"),
      phoneVisibility: vis("phoneVisibility"), personalEmailVisibility: vis("personalEmailVisibility"), birthdayVisibility: vis("birthdayVisibility"),
    })
    .where(eq(s.users.id, actor.id));
  await audit(actor.id, "profile.updated", { type: "user", id: actor.id });
  revalidatePath(`/people/${actor.id}`);
  return { ok: true, message: "Profile saved." };
}

function Vis({ name, value }: { name: string; value: string }) {
  return (
    <select name={name} defaultValue={value} className="input">
      <option value="internal">Everyone internal</option>
      <option value="restricted">My leadership chain & MC only</option>
      <option value="private">Only me</option>
    </select>
  );
}

export default async function ProfilePage() {
  const { actor } = await requireActor();
  const u = actor.user;
  return (
    <>
      <PageHeader title="Edit profile & privacy" subtitle="You control who sees your personal contact details. Reviews, finance and HR information are never public." />
      <Card className="max-w-4xl">
        <ActionForm action={saveProfile} className="grid gap-4 md:grid-cols-2">
          <Field label="Full name"><input name="name" defaultValue={u.name} className="input" required /></Field>
          <Field label="Preferred name"><input name="preferredName" defaultValue={u.preferredName ?? ""} className="input" /></Field>
          <Field label="Phone"><input name="phone" defaultValue={u.phone ?? ""} className="input" /></Field>
          <Field label="Who sees your phone"><Vis name="phoneVisibility" value={u.phoneVisibility} /></Field>
          <Field label="Personal email"><input name="personalEmail" type="email" defaultValue={u.personalEmail ?? ""} className="input" /></Field>
          <Field label="Who sees your personal email"><Vis name="personalEmailVisibility" value={u.personalEmailVisibility} /></Field>
          <Field label="Birthday"><input name="birthday" type="date" defaultValue={u.birthday ?? ""} className="input" /></Field>
          <Field label="Who sees your birthday"><Vis name="birthdayVisibility" value={u.birthdayVisibility} /></Field>
          <Field label="Emergency contact" hint="Always restricted to your leadership chain & MC."><input name="emergencyContact" defaultValue={u.emergencyContact ?? ""} className="input" /></Field>
          <Field label="University"><input name="university" defaultValue={u.university ?? ""} className="input" /></Field>
          <Field label="Location"><input name="location" defaultValue={u.location ?? ""} className="input" /></Field>
          <Field label="Photo URL (https)"><input name="photoUrl" defaultValue={u.photoUrl ?? ""} className="input" /></Field>
          <Field label="Skills (comma separated)"><input name="skills" defaultValue={u.skills.join(", ")} className="input" /></Field>
          <Field label="Languages"><input name="languages" defaultValue={u.languages.join(", ")} className="input" /></Field>
          <Field label="LinkedIn"><input name="linkedin" defaultValue={u.linkedin ?? ""} className="input" /></Field>
          <Field label="Portfolio / GitHub"><input name="portfolio" defaultValue={u.portfolio ?? ""} className="input" /></Field>
          <div className="md:col-span-2"><Field label="About me"><textarea name="bio" rows={4} defaultValue={u.bio ?? ""} className="input" /></Field></div>
          <div className="md:col-span-2"><SubmitButton>Save profile</SubmitButton></div>
        </ActionForm>
      </Card>
    </>
  );
}
