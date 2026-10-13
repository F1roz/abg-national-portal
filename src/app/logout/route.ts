import { NextResponse } from "next/server";
import { destroySession, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function POST(req: Request) {
  const sess = await getSession();
  await destroySession();
  if (sess) await audit(sess.user.id, "auth.logout", { type: "user", id: sess.user.id });
  return NextResponse.redirect(new URL("/login", req.url), 303);
}
