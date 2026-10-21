/**
 * "Break it on stage": a judge breaks a healthy demo app with one click.
 * Breaking is itself a destructive change (it overwrites/removes an env var),
 * so it goes through the same rules: ALLOW_DESTRUCTIVE=true, ALLOWED_APPS,
 * and the app name typed as confirmation. Every break is audited.
 */
import { MockLiaraClient, type ChaosScenario } from "@rahandaz/liara";
import { appAllowed } from "../config/config";
import type { AuditActor } from "../audit/audit-log";
import type { AgentRuntime } from "./runtime";

export const CHAOS_SCENARIOS: Array<{ id: ChaosScenario; titleFa: string; descriptionFa: string }> = [
  { id: "missing_env", titleFa: "حذف یک متغیر محیطی", descriptionFa: "یک متغیر ضروری (مثل SESSION_SECRET) از اپ حذف می‌شود؛ اپ موقع شروع کرش می‌کند." },
  { id: "wrong_port", titleFa: "پورت اشتباه", descriptionFa: "متغیر PORT روی ۸۰۸۱ تنظیم می‌شود؛ برنامه روی پورتی گوش می‌دهد که لیارا چک نمی‌کند." },
];

export async function breakApp(
  runtime: AgentRuntime,
  input: { app: string; scenario: ChaosScenario; actor: string; confirmText: string },
): Promise<{ ok: boolean; errorFa?: string; touched?: string }> {
  const { config, audit, liara } = runtime;
  const actor = input.actor as AuditActor;
  const deny = (errorFa: string, reason: string) => {
    audit.append({ actor, action: "chaos_break", tool: "chaos", kind: "destructive", resource: input.app, result: "blocked", detail: `${input.scenario}: ${reason}` });
    return { ok: false, errorFa };
  };
  if (!config.allowDestructive) return deny("برای «خرابش کن» باید ALLOW_DESTRUCTIVE=true باشد؛ این کار یک تغییر حساس است.", "ALLOW_DESTRUCTIVE is false");
  if (!appAllowed(config, input.app)) return deny(`اپ ${input.app} در ALLOWED_APPS نیست.`, "outside ALLOWED_APPS");
  if (input.confirmText.trim() !== input.app) return deny(`برای تأیید، نام اپ «${input.app}» را دقیقاً تایپ کنید.`, "typed confirmation mismatch");
  if (config.dryRun) return deny("در حالت DRY_RUN چیزی خراب نمی‌شود.", "dry run");

  let touched: string;
  if (liara instanceof MockLiaraClient) {
    touched = liara.breakApp(input.app, input.scenario);
  } else {
    // Real mode: only the PORT override is supported (adds/overwrites one env var). UNVERIFIED end-to-end on a live account.
    if (input.scenario !== "wrong_port") return deny("در حالت واقعی فقط سناریوی «پورت اشتباه» پشتیبانی می‌شود.", "scenario unsupported in real mode");
    await liara.setEnvVars(input.app, [{ key: "PORT", value: "8081" }]);
    touched = "PORT";
  }
  audit.append({ actor, action: "chaos_break", tool: "chaos", kind: "destructive", resource: input.app, result: "ok", detail: `${input.scenario} (${touched})` });
  return { ok: true, touched };
}
