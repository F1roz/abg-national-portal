import { timingSafeEqual } from "node:crypto";
import { runAll } from "@/jobs/engine";

/** Called by an external scheduler every 15 minutes: POST /api/cron with header `Authorization: Bearer $CRON_SECRET`. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || secret === "change-me" || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json(await runAll("cron"));
}
