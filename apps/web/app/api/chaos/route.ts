import { breakApp, CHAOS_SCENARIOS } from "@rahandaz/core";
import { actorFrom, body, guard, json, rz } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const b = await body<{ app?: string; scenario?: string; confirmText?: string }>(req);
  const scenario = CHAOS_SCENARIOS.find((c) => c.id === b?.scenario)?.id;
  if (!b?.app || !scenario) return json({ errorFa: "درخواست نامعتبر است." }, 400);
  const res = await breakApp(rz().runtime, { app: b.app, scenario, actor: actorFrom(req), confirmText: b.confirmText ?? "" });
  return json({ ...res, at: new Date().toISOString() }, res.ok ? 200 : 422);
}
