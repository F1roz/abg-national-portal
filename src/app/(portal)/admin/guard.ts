import { requireActor, denied } from "@/lib/session";

/** Full administrators only: MCP, system admin, IM admin. */
export async function requireFullAdmin() {
  const ctx = await requireActor();
  if (!(ctx.actor.isMCP || ctx.actor.system.has("system_admin") || ctx.actor.system.has("im_admin"))) denied();
  return ctx;
}
