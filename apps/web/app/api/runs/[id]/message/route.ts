import { actorFrom, body, guard, json, rz } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const b = await body<{ text?: string }>(req);
  if (!b?.text?.trim()) return json({ errorFa: "پیام خالی است." }, 400);
  const res = rz().runtime.sendMessage(id, b.text.trim(), actorFrom(req));
  return json(res, res.ok ? 200 : 409);
}
