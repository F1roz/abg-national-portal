import { and, eq, inArray, ne } from "drizzle-orm";
import { db, s } from "@/db";
import { canAssignTaskTo, type Actor, type Org } from "./access";
import { positionLabels } from "./org";

export type PersonOption = { id: string; name: string; label: string };

/** Everyone the actor may assign work to, with their position labels (for selects). */
export async function assignablePeople(actor: Actor, org: Org): Promise<PersonOption[]> {
  const holders = [...org.userPositions.keys()];
  const ids = holders.filter((u) => canAssignTaskTo(actor, org, u));
  if (!ids.includes(actor.id)) ids.push(actor.id);
  const users = await db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(and(inArray(s.users.id, ids), eq(s.users.status, "active"), ne(s.users.userType, "partner")));
  return users
    .map((u) => ({ id: u.id, name: u.name, label: positionLabels(org, u.id)[0] ?? "" }))
    .sort((a, b) => (a.id === actor.id ? -1 : b.id === actor.id ? 1 : a.name.localeCompare(b.name)));
}

/** All active internal people (directory-style selects: backup person, recognition, mentors…). */
export async function internalPeople(org: Org): Promise<PersonOption[]> {
  const users = await db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(and(eq(s.users.status, "active"), eq(s.users.userType, "internal")));
  return users.map((u) => ({ id: u.id, name: u.name, label: positionLabels(org, u.id)[0] ?? "" })).sort((a, b) => a.name.localeCompare(b.name));
}
