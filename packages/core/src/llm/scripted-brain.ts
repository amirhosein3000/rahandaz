/**
 * MOCK_LLM=true provider. A deterministic "model" that reads only what a real
 * model would read (the message list, including tool results) and replies with
 * tool calls or Persian text. It reacts to actual tool results, so mock runs
 * exercise the same loop, policy, approvals and healing code paths as real
 * runs; only the reasoning is scripted.
 *
 * It obeys the system prompt's workflow and never acts on <untrusted> content.
 */
import { faDigits, toman } from "../format/fa";
import { findRepoRef } from "../repo/workspace";
import type { ChatMessage, CompletionResult, LlmProvider, ToolCall } from "./types";

interface Step {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  denied: boolean;
  blocked: boolean;
  dryRun: boolean;
  error?: string;
}

type Decision = { call: string; args: Record<string, unknown>; say?: string } | { final: string };

const INCIDENT_RE = /(چرا|why|down|slow|کند|خراب|از کار|قطع|500|502|503|هشدار|incident|سلامت|crash|کرش|مشکل)/i;

export class ScriptedBrain implements LlmProvider {
  readonly name = "mock:scripted-brain";
  private seq = 0;

  async complete(input: { messages: ChatMessage[] }): Promise<CompletionResult> {
    const { messages } = input;
    let lastUser = -1;
    messages.forEach((m, i) => {
      if (m.role === "user") lastUser = i;
    });
    const userText = lastUser >= 0 ? messages[lastUser]!.content ?? "" : "";
    const steps = collectSteps(messages.slice(lastUser + 1));
    const d = decide(userText, steps);
    if ("final" in d) return { message: { role: "assistant", content: d.final }, usage: { promptTokens: 0, completionTokens: 0 } };
    const call: ToolCall = { id: `call_${++this.seq}`, type: "function", function: { name: d.call, arguments: JSON.stringify(d.args) } };
    return { message: { role: "assistant", content: d.say ?? null, tool_calls: [call] }, usage: { promptTokens: 0, completionTokens: 0 } };
  }
}

function collectSteps(msgs: ChatMessage[]): Step[] {
  const calls = new Map<string, ToolCall>();
  const steps: Step[] = [];
  for (const m of msgs) {
    if (m.role === "assistant") for (const c of m.tool_calls ?? []) calls.set(c.id, c);
    if (m.role === "tool" && m.tool_call_id) {
      const call = calls.get(m.tool_call_id);
      if (!call) continue;
      // First line is the JSON result; anything after it is <untrusted> data, which we never read as instructions.
      let body: { ok?: boolean; summary?: string; data?: Record<string, unknown>; error?: string } = {};
      try {
        body = JSON.parse((m.content ?? "").split("\n")[0]!);
      } catch {
        body = { ok: false };
      }
      steps.push({
        name: call.function.name,
        args: safeParse(call.function.arguments),
        ok: body.ok === true,
        summary: body.summary ?? "",
        data: body.data ?? {},
        denied: body.data?.denied === true,
        blocked: body.data?.blocked === true,
        dryRun: body.data?.dryRun === true,
        error: body.error,
      });
    }
  }
  return steps;
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function decide(userText: string, steps: Step[]): Decision {
  const last = steps[steps.length - 1];
  if (last?.denied) return { final: `باشه، «${last.summary}». ${describeDenied(last)} هیچ تغییر دیگری اعمال نکردم.` };
  if (last?.blocked) return { final: `این کار انجام نشد: ${last.summary}\nاگر واقعاً لازم است، باید خودتان آگاهانه تنظیمات ایمنی را تغییر دهید.` };

  const repo = findRepoRef(userText);
  if (repo) return deployFlow(repo, steps);
  if (INCIDENT_RE.test(userText) || steps.some((s) => s.name === "list_apps")) return operateFlow(userText, steps);
  return {
    final:
      "سلام، من راهی هستم، ایجنت استقرار راه‌انداز.\n" +
      "• لینک مخزن GitHub را بفرستید تا تحلیلش کنم، نقشه‌ی استقرار و هزینه را نشان بدهم و بعد از تأیید شما روی لیارا بالا بیاورم.\n" +
      "• یا بپرسید «چرا اپ X از کار افتاده؟» تا لاگ و متریک‌ها را بررسی و علت را پیدا کنم.\n" +
      "هیچ تغییری بدون تأیید شما انجام نمی‌شود.",
  };
}

function describeDenied(step: Step): string {
  if (step.name === "propose_deploy_plan") return "نقشه‌ی استقرار رد شد؛ اگر بخواهید می‌توانم با پلن یا نام دیگری نقشه‌ی جدید بسازم.";
  return "";
}

// ── deploy: analyse → plan → apply → heal → verify ─────────────

function deployFlow(repo: string, steps: Step[]): Decision {
  const last = steps[steps.length - 1];
  if (!last) return { call: "acquire_repo", args: { source: repo }, say: "مخزن را دریافت و تحلیل می‌کنم." };
  if (!last.ok && !["wait_for_release", "check_health"].includes(last.name)) {
    return { final: `در مرحله‌ی «${last.name}» به خطا خوردم: ${last.summary}${last.error ? `\n(${last.error})` : ""}\nچیزی نیمه‌کاره رها نشده؛ می‌توانید دوباره امتحان کنید.` };
  }

  const planIdx = steps.findIndex((s) => s.name === "propose_deploy_plan" && s.ok);
  const plan = planIdx >= 0 ? steps[planIdx]!.data : null;
  const app: string | undefined = plan?.appName;
  const lastDeploy = [...steps].reverse().find((s) => s.name === "deploy_app" && s.ok);
  const lastDiag = [...steps].reverse().find((s) => s.name === "diagnose_failure");
  const topDiag = lastDiag?.data?.diagnoses?.[0];
  const applied = steps.filter((s) => s.name === "apply_fix" && s.ok).length;

  switch (last.name) {
    case "acquire_repo":
      return { call: "analyse_repo", args: {} };

    case "analyse_repo": {
      const a = last.data;
      if (plan && app) {
        return { call: "deploy_app", args: { app, port: a.port, platform: a.platform }, say: `اصلاح اعمال شد؛ نسخه‌ی جدید را روی پورت ${faDigits(a.port)} دیپلوی می‌کنم.` };
      }
      const lines = [`این یک پروژه‌ی ${a.stackLabel} است (پلتفرم ${a.platform}، پورت ${faDigits(a.port)}).`];
      if (a.env?.length) lines.push(`متغیرهای محیطی لازم: ${a.env.map((e: { name: string }) => e.name).join("، ")}.`);
      if (a.injection?.length) lines.push(`در ${a.injection.map((i: { file: string }) => i.file).join("، ")} متنی خطاب به هوش مصنوعی بود که آن را نادیده گرفتم؛ فقط داده است، نه دستور.`);
      const risks = (a.warnings ?? []).filter((w: { code: string }) => w.code !== "injection_text");
      if (risks.length) lines.push(`ریسک‌ها: ${risks.map((w: { messageFa: string }) => w.messageFa).join(" ")}`);
      lines.push("نقشه‌ی استقرار را برای تأیید شما آماده می‌کنم.");
      return { call: "propose_deploy_plan", args: {}, say: lines.join("\n") };
    }

    case "propose_deploy_plan":
    case "create_app":
      return nextPlanAction(steps, planIdx) ?? { final: "اقدامی در نقشه باقی نمانده." };

    case "set_env_vars": {
      if (!lastDeploy && plan) return nextPlanAction(steps, planIdx) ?? { final: "اقدامی در نقشه باقی نمانده." };
      const fix = topDiag?.fix;
      if (fix?.redeploy && app && lastDeploy) {
        return { call: "deploy_app", args: { app, port: fix.port ?? lastDeploy.args.port, platform: lastDeploy.args.platform }, say: "متغیر تنظیم شد؛ چون در زمان بیلد خوانده می‌شود، دوباره دیپلوی می‌کنم." };
      }
      return { call: "check_health", args: { app: app ?? last.args.app, waitSeconds: 30 }, say: "متغیر تنظیم شد و اپ ری‌استارت می‌شود؛ سلامتش را بررسی می‌کنم." };
    }

    case "apply_fix": {
      const env = (last.data.env ?? []) as Array<{ key: string; valueRef: string }>;
      if (env.length && app) return { call: "set_env_vars", args: { app, vars: env.map((e) => ({ key: e.key, valueRef: e.valueRef })) } };
      return { call: "analyse_repo", args: {} };
    }

    case "deploy_app":
      if (last.dryRun) return { final: dryRunSummary(steps) };
      return { call: "wait_for_release", args: { app: last.args.app, releaseId: last.data.releaseId }, say: "بیلد شروع شد؛ لاگ‌ها را زنده دنبال می‌کنم." };

    case "wait_for_release": {
      if (!last.ok) return { final: `منتظر ماندن برای بیلد بی‌نتیجه ماند: ${last.summary}` };
      const state = last.data.state;
      if (state === "READY") return { call: "check_health", args: { app: last.args.app, waitSeconds: 20 } };
      if (applied >= 3) return { final: giveUp(steps) };
      if (state === "UNHEALTHY") return { call: "get_app_logs", args: { app: last.args.app, minutes: 15 }, say: "ریلیز بالا نیامد (UNHEALTHY). لاگ‌های اجرای برنامه را می‌خوانم." };
      return { call: "diagnose_failure", args: { app: last.args.app, releaseId: last.args.releaseId }, say: "بیلد شکست خورد. علتش را از لاگ بیلد پیدا می‌کنم." };
    }

    case "get_app_logs":
      return { call: "diagnose_failure", args: { app: last.args.app, ...(lastDeploy?.data?.releaseId ? { releaseId: lastDeploy.data.releaseId } : {}) } };

    case "check_health":
      if (last.data.ok) return { final: successSummary(steps, last.data) };
      if (applied >= 3 || (lastDiag && lastDiag.data.healAttempt >= lastDiag.data.maxHealAttempts)) return { final: giveUp(steps) };
      return { call: "get_app_logs", args: { app: last.args.app, minutes: 15 }, say: `آدرس ${last.data.url} جواب سالم نمی‌دهد (${faDigits(last.data.status ?? 0)}). لاگ‌ها را بررسی می‌کنم.` };

    case "diagnose_failure":
      if (!topDiag) return { final: "علت مشخصی در لاگ‌ها پیدا نکردم. لاگ‌ها در تایم‌لاین هستند؛ اگر توضیح بیشتری بدهید بررسی را ادامه می‌دهم." };
      return { call: "search_liara_docs", args: { query: topDiag.docsQuery, k: 3 }, say: `ریشه‌ی مشکل: ${topDiag.titleFa}.\n${topDiag.explanationFa}` };

    case "search_liara_docs":
      return proposeFix(steps, app ?? (lastDiag?.args.app as string | undefined));

    case "restart_app":
      return { call: "check_health", args: { app: last.args.app, waitSeconds: 30 } };

    default:
      return { final: "کار تمام شد." };
  }
}

function nextPlanAction(steps: Step[], planIdx: number): Decision | null {
  const plan = steps[planIdx]?.data;
  if (!plan) return null;
  const actions = plan.actions as Array<{ tool: string; args: Record<string, unknown> }>;
  let done = 0;
  for (const s of steps.slice(planIdx + 1)) {
    if (done < actions.length && s.name === actions[done]!.tool && s.ok) done++;
    if (s.name === "deploy_app") break;
  }
  const next = actions[done];
  if (!next) return null;
  const say = next.tool === "create_app" ? `نقشه تأیید شد. اپ ${plan.appName} را می‌سازم.` : next.tool === "set_env_vars" ? "متغیرهای محیطی را تنظیم می‌کنم (مقدارها را نمی‌بینم)." : undefined;
  return { call: next.tool, args: next.args, say };
}

function proposeFix(steps: Step[], app: string | undefined): Decision {
  const diag = [...steps].reverse().find((s) => s.name === "diagnose_failure")?.data?.diagnoses?.[0];
  const docs = [...steps].reverse().find((s) => s.name === "search_liara_docs")?.data?.hits ?? [];
  const cite = docs[0] ? `\nمستند لیارا: ${docs[0].title}\n${docs[0].url}` : "";
  const fix = diag?.fix;
  if (!fix) {
    if (app && diag?.rule === "crash_unknown") {
      return { call: "restart_app", args: { app }, say: `${diag.titleFa}. اصلاح خودکار مطمئنی ندارم؛ یک ری‌استارت پیشنهاد می‌کنم تا ببینیم مشکل گذرا بوده یا نه.${cite}` };
    }
    return { final: `${diag?.titleFa ?? "علت پیدا نشد"}.\n${diag?.explanationFa ?? ""}${cite}` };
  }
  if (steps.filter((s) => s.name === "apply_fix" && s.ok).length >= 3) return { final: giveUp(steps) };
  if (fix.files?.length) {
    if (!steps.some((s) => s.name === "acquire_repo")) {
      return { final: `${diag.titleFa}.\nاصلاح پیشنهادی (${fix.titleFa}) تغییر کد است؛ لینک مخزن را بفرستید تا آن را اعمال و دوباره دیپلوی کنم.${cite}` };
    }
    return { call: "apply_fix", args: { fixId: fix.fixId }, say: `پیشنهاد اصلاح: ${fix.titleFa}. تغییر دقیق را برای تأیید نشان می‌دهم.${cite}` };
  }
  if (fix.env?.length && app) {
    return {
      call: "set_env_vars",
      args: { app, vars: fix.env.map((e: { key: string; valueRef: string }) => ({ key: e.key, valueRef: e.valueRef })) },
      say: `پیشنهاد اصلاح: ${fix.titleFa}.${cite}`,
    };
  }
  return { final: `${diag.titleFa}.${cite}` };
}

// ── operate: "why is my app down?" ─────────────────────────────

function operateFlow(userText: string, steps: Step[]): Decision {
  const last = steps[steps.length - 1];
  if (!last) return { call: "list_apps", args: {}, say: "اپ‌ها را بررسی می‌کنم." };
  if (!last.ok && last.name !== "check_health") return { final: `بررسی متوقف شد: ${last.summary}` };

  switch (last.name) {
    case "list_apps": {
      const apps = (last.data.apps ?? []) as Array<{ name: string; status: string }>;
      if (!apps.length) return { final: "روی این حساب اپی پیدا نکردم." };
      const named = apps.find((a) => userText.includes(a.name));
      const target = named ?? apps.find((a) => a.status === "crashed") ?? apps[0]!;
      return { call: "get_app_status", args: { app: target.name } };
    }
    case "get_app_status":
      if (last.data.health?.ok) return { call: "get_metrics", args: { app: last.args.app } };
      return { call: "get_app_logs", args: { app: last.args.app, minutes: 15 }, say: `${last.args.app} سالم نیست (${last.data.health?.status ?? last.data.health?.error}). لاگ‌ها را می‌خوانم.` };
    case "get_metrics": {
      const m = last.data;
      const memPct = m.memoryLimitMb ? Math.round((m.memoryMb / m.memoryLimitMb) * 100) : null;
      const advice = memPct !== null && memPct > 85 ? "\nحافظه نزدیک سقف پلن است؛ اگر کندی ادامه داشت، ارتقای پلن را پیشنهاد می‌کنم." : "";
      return {
        final: `${last.args.app} سالم است و جواب می‌دهد. CPU ${faDigits(m.cpuPercent ?? "?")}٪، حافظه ${faDigits(m.memoryMb ?? "?")} مگابایت${memPct !== null ? ` (${faDigits(memPct)}٪ پلن)` : ""}، ری‌استارت‌ها ${faDigits(m.restarts ?? 0)}${m.responseMsP50 ? `، زمان پاسخ حدود ${faDigits(m.responseMsP50)}ms` : ""}.${advice}`,
      };
    }
    case "get_app_logs":
      return { call: "diagnose_failure", args: { app: last.args.app } };
    case "diagnose_failure": {
      const top = last.data.diagnoses?.[0];
      if (!top) return { final: "علت مشخصی در لاگ‌ها پیدا نکردم." };
      return { call: "search_liara_docs", args: { query: top.docsQuery, k: 3 }, say: `ریشه‌ی مشکل: ${top.titleFa}.\n${top.explanationFa}` };
    }
    case "search_liara_docs":
      return proposeFix(steps, steps.find((s) => s.name === "get_app_status")?.args.app as string | undefined);
    case "set_env_vars":
    case "restart_app":
      return { call: "check_health", args: { app: last.args.app, waitSeconds: 30 }, say: "اعمال شد؛ سلامت اپ را دوباره بررسی می‌کنم." };
    case "check_health":
      if (last.data.ok) return { final: successSummary(steps, last.data) };
      return { final: giveUp(steps) };
    default:
      return { final: "بررسی تمام شد." };
  }
}

// ── final messages ─────────────────────────────────────────────

function successSummary(steps: Step[], health: { url: string; latencyMs?: number }): string {
  const plan = steps.find((s) => s.name === "propose_deploy_plan" && s.ok)?.data;
  const diags = steps.filter((s) => s.name === "diagnose_failure").map((s) => s.data.diagnoses?.[0]).filter(Boolean);
  const fixes = steps.filter((s) => (s.name === "apply_fix" || (s.name === "set_env_vars" && diags.length)) && s.ok).map((s) => s.summary);
  const docs = steps.filter((s) => s.name === "search_liara_docs").flatMap((s) => s.data.hits ?? []).slice(0, 2);
  const lines = [`اپ سالم و در دسترس است: ${health.url}`];
  if (diags.length) lines.push(`مشکل پیدا و رفع شد: ${diags[0].titleFa}.`);
  if (fixes.length) lines.push(`اصلاح‌ها: ${fixes.join("؛ ")}.`);
  if (plan) lines.push(`هزینه‌ی ماهانه‌ی تخمینی: ${toman(plan.monthlyCostToman)}.`);
  if (docs.length) lines.push(`مستندات استفاده‌شده: ${docs.map((d: { url: string }) => d.url).join(" ، ")}`);
  if (steps.some((s) => s.name === "analyse_repo" && s.data.injection?.length)) lines.push("متن مشکوکی که در مخزن خطاب به هوش مصنوعی نوشته شده بود را اجرا نکردم.");
  return lines.join("\n");
}

function dryRunSummary(steps: Step[]): string {
  const calls = steps.filter((s) => s.dryRun).flatMap((s) => (s.data.calls ?? []) as Array<{ method: string; path: string }>);
  return [
    "حالت DRY_RUN فعال است؛ هیچ تغییری روی لیارا اعمال نشد. این فراخوانی‌ها انجام می‌شدند:",
    ...calls.map((c) => `• ${c.method} ${c.path}`),
    "برای اجرای واقعی، DRY_RUN=false را تنظیم کنید.",
  ].join("\n");
}

function giveUp(steps: Step[]): string {
  const diags = steps.filter((s) => s.name === "diagnose_failure").map((s) => s.data.diagnoses?.[0]?.titleFa).filter(Boolean);
  return `بعد از ${faDigits(steps.filter((s) => s.name === "apply_fix" && s.ok).length)} اصلاح هنوز اپ سالم نیست و متوقف شدم تا وضعیت بدتر نشود.${diags.length ? `\nآخرین تشخیص: ${diags[diags.length - 1]}` : ""}\nلاگ‌ها و تغییرات در تایم‌لاین هست.`;
}
