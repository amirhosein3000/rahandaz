/**
 * The policy layer. Pure functions, no I/O: given a tool call's safety class
 * and the run's approval records, decide execute / ask / block. The safety
 * rules from CLAUDE.md are enforced HERE, not in the prompt:
 *
 *  - read-only           → execute freely
 *  - mutating / plan     → only with a user approval bound to this exact call
 *  - destructive         → blocked unless ALLOW_DESTRUCTIVE=true; then its own
 *                          approval with the resource name typed by the user
 *  - outside ALLOWED_APPS→ blocked
 *  - over MAX_MONTHLY_COST → approval must carry an explicit budget override
 *
 * Approvals can only be created by RunManager.resolveApproval(), which is
 * called from the user's channel (web console, CLI prompt, chat bot button);
 * nothing a tool returns can create or modify one.
 */
import { appAllowed, type RahandazConfig } from "../config/config";
import type { ApprovalRequest, GateKind, RunState } from "../agent/types";

export type PolicyDecision =
  | { action: "execute"; kind: GateKind; viaApproval: string | null }
  | { action: "ask"; kind: Exclude<GateKind, "read">; requireTypedConfirmation?: string; requireBudgetOverride: boolean }
  | { action: "block"; kind: GateKind; reason: string; reasonFa: string };

export interface PolicyInput {
  tool: string;
  kind: GateKind;
  resource: string | null;
  fingerprint: string;
  monthlyCostToman: number | null;
  run: Pick<RunState, "approved" | "approvals">;
  config: Pick<RahandazConfig, "allowDestructive" | "allowedApps" | "maxMonthlyCostToman">;
}

export function evaluatePolicy(p: PolicyInput): PolicyDecision {
  if (p.kind === "read") return { action: "execute", kind: "read", viaApproval: null };

  if (p.resource && p.kind !== "plan" && !appAllowed(p.config, p.resource)) {
    return {
      action: "block",
      kind: p.kind,
      reason: `app "${p.resource}" is outside ALLOWED_APPS (${p.config.allowedApps.join(",")})`,
      reasonFa: `اپ «${p.resource}» در فهرست اپ‌های مجاز (ALLOWED_APPS) نیست؛ هیچ تغییری روی آن اعمال نمی‌شود.`,
    };
  }

  if (p.kind === "destructive" && !p.config.allowDestructive) {
    return {
      action: "block",
      kind: p.kind,
      reason: `${p.tool} is destructive and ALLOW_DESTRUCTIVE is not true`,
      reasonFa: "این عملیات حساس است (حذف/بازنویسی/خاموش‌کردن) و تا ALLOW_DESTRUCTIVE=true نباشد کاملاً غیرفعال است.",
    };
  }

  const approvalId = p.run.approved[p.fingerprint];
  if (approvalId) {
    const approval = p.run.approvals.find((a) => a.id === approvalId);
    // A destructive call is only covered by an approval that was itself a typed destructive confirmation.
    const covers = approval && approval.status === "approved" && (p.kind !== "destructive" || approval.kind === "destructive");
    if (covers) return { action: "execute", kind: p.kind, viaApproval: approvalId };
  }

  return {
    action: "ask",
    kind: p.kind,
    requireTypedConfirmation: p.kind === "destructive" ? p.resource ?? p.tool : undefined,
    requireBudgetOverride: p.monthlyCostToman !== null && p.monthlyCostToman > p.config.maxMonthlyCostToman,
  };
}

export interface ResolutionInput {
  decision: "approved" | "denied";
  confirmText?: string;
  budgetOverride?: boolean;
  secretValues?: Record<string, string>;
}

/** Check that an approval response satisfies what the request demanded. Returns an error (Persian) or null. */
export function validateResolution(approval: ApprovalRequest, input: ResolutionInput): string | null {
  if (approval.status !== "pending") return "این درخواست قبلاً پاسخ داده شده است.";
  if (input.decision === "denied") return null;
  if (approval.requireTypedConfirmation && input.confirmText?.trim() !== approval.requireTypedConfirmation) {
    return `برای تأیید عملیات حساس باید دقیقاً نام «${approval.requireTypedConfirmation}» را تایپ کنید.`;
  }
  if (approval.requireBudgetOverride && input.budgetOverride !== true) {
    return "هزینه‌ی ماهانه از سقف بودجه (MAX_MONTHLY_COST) بیشتر است؛ باید عبور از سقف را صریحاً تأیید کنید.";
  }
  const missing = approval.secretInputs.filter((s) => !input.secretValues?.[s.key]?.trim());
  if (missing.length) return `مقدار ${missing.map((m) => m.key).join("، ")} را وارد کنید.`;
  return null;
}
