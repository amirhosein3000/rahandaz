import { actorFrom, guard, json, rz } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  return json({ ok: rz().runtime.stopRun(id, actorFrom(req)) });
}
