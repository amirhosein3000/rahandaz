import { guard, json, rz } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const r = rz();
  return json({ entries: r.audit.list({ limit: 300 }), verify: r.audit.verify() });
}
