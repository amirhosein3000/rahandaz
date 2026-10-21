import { actorFrom, body, guard, json, rz } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const b = await body<{ message?: string }>(req);
  const message = b?.message?.trim();
  if (!message || message.length > 2000) return json({ errorFa: "پیام خالی یا خیلی طولانی است." }, 400);
  const run = rz().runtime.startRun({ message, actor: actorFrom(req) });
  return json({ runId: run.id });
}
