import { actorFrom, body, guard, json, rz } from "@/lib/server";

export const dynamic = "force-dynamic";

/** The ONLY web entry point that can approve an action. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; approvalId: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id, approvalId } = await ctx.params;
  const b = await body<{ decision?: string; confirmText?: string; budgetOverride?: boolean; secretValues?: Record<string, string> }>(req);
  if (b?.decision !== "approved" && b?.decision !== "denied") return json({ errorFa: "تصمیم نامعتبر است." }, 400);
  const res = await rz().runtime.resolveApproval(id, approvalId, {
    decision: b.decision,
    actor: actorFrom(req),
    confirmText: typeof b.confirmText === "string" ? b.confirmText : undefined,
    budgetOverride: b.budgetOverride === true,
    secretValues: b.secretValues && typeof b.secretValues === "object" ? b.secretValues : undefined,
  });
  return json(res, res.ok ? 200 : 422);
}
