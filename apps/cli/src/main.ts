#!/usr/bin/env tsx
/**
 * Rahandaz in the terminal.
 *   pnpm cli "https://github.com/acme/node-wrong-port"
 *   pnpm cli "چرا demo-shop از کار افتاده؟"
 *   pnpm cli --audit            # print the audit log and verify its hash chain
 *   pnpm cli --break demo-shop  # «خرابش کن» (needs ALLOW_DESTRUCTIVE=true), then watch the agent heal it
 * Approvals are asked here, in the terminal: that is the user's channel.
 */
import readline from "node:readline";
import { Writable } from "node:stream";
import { breakApp, createRahandaz, formatCallLine, toman, type AgentEvent, type ApprovalRequest } from "./deps";

const C = { dim: "\x1b[2m", bold: "\x1b[1m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", reset: "\x1b[0m" };

async function main() {
  const args = process.argv.slice(2);
  const app = createRahandaz();
  const { config } = app;
  console.log(
    `${C.bold}راه‌انداز${C.reset} ${C.dim}· Liara=${config.liaraMode} · LLM=${app.llm.name} · DRY_RUN=${config.dryRun} · ALLOW_DESTRUCTIVE=${config.allowDestructive}${C.reset}`,
  );

  if (args[0] === "--audit") {
    for (const e of app.audit.list({ limit: 50 }).reverse()) {
      console.log(`${C.dim}#${e.seq} ${e.ts}${C.reset} ${e.actor} ${e.action}${e.tool ? ` ${e.tool}` : ""}${e.resource ? ` [${e.resource}]` : ""} → ${e.result}${e.detail ? ` ${C.dim}(${e.detail})${C.reset}` : ""}`);
    }
    const v = app.audit.verify();
    console.log(v.ok ? `${C.green}✓ hash chain intact (${v.count} entries)${C.reset}` : `${C.red}✗ chain broken at #${v.brokenAt}${C.reset}`);
    return;
  }

  let message = args.join(" ").trim();
  if (args[0] === "--break") {
    const target = args[1] ?? "demo-shop";
    const confirm = await ask(`${C.yellow}«خرابش کن» یک تغییر حساس است. برای تأیید نام اپ را تایپ کنید (${target}): ${C.reset}`);
    const res = await breakApp(app.runtime, { app: target, scenario: (args[2] as "missing_env" | "wrong_port") ?? "missing_env", actor: "user:cli", confirmText: confirm });
    if (!res.ok) {
      console.log(`${C.red}${res.errorFa}${C.reset}`);
      process.exit(1);
    }
    console.log(`${C.red}✗ ${target} خراب شد (${res.touched}).${C.reset} نگهبان سلامت باید آن را ببیند…`);
    await app.monitor.tick(); // baseline would normally exist; in the CLI we trigger directly
    message = `هشدار: اپ ${target} از دسترس خارج شد. چرا از کار افتاده و چطور درستش کنیم؟`;
  }
  if (!message) message = (await ask("پیام یا لینک مخزن: ")).trim();
  if (!message) return;

  const run = app.runtime.startRun({ message, actor: "user:cli" });
  app.runtime.subscribe(run.id, (e) => print(e));
  for (;;) {
    const state = await app.runtime.settled(run.id, 30 * 60_000);
    if (state.status !== "awaiting_approval") break;
    const approval = state.approvals.find((a) => a.id === state.pendingApprovalId)!;
    await answer(app, run.id, approval);
  }
  rlClose();
}

function print(e: AgentEvent) {
  switch (e.type) {
    case "assistant":
      console.log(`\n${C.cyan}راهی:${C.reset} ${e.text}`);
      break;
    case "tool_call":
      console.log(`${C.dim}→ ${e.titleFa}  [${e.tool} · ${e.kind}]${C.reset}`);
      break;
    case "tool_result":
      console.log(`${e.ok ? C.green + "  ✓" : C.red + "  ✗"} ${e.summaryFa}${C.reset}`);
      for (const c of e.calls ?? []) console.log(`${C.yellow}    ${formatCallLine(c)}${C.reset}`);
      break;
    case "log":
      for (const l of e.lines) console.log(`${C.dim}  │ ${l}${C.reset}`);
      break;
    case "release":
      console.log(`${C.dim}  ◦ ریلیز ${e.releaseId}: ${e.state}${C.reset}`);
      break;
    case "injection_warning":
      console.log(`${C.yellow}  ⚠ متن شبیه دستور به هوش مصنوعی در ${e.source} (${e.findings.map((f) => f.rule).join(", ")}). نادیده گرفته شد.${C.reset}`);
      break;
    case "policy_blocked":
      console.log(`${C.red}  ⛔ ${e.reasonFa}${C.reset}`);
      break;
    case "docs":
      for (const h of e.hits) console.log(`${C.dim}  📄 ${h.title}  ${h.url}${C.reset}`);
      break;
    case "health":
      console.log(e.health.ok ? `${C.green}  ♥ ${e.health.url} سالم (${e.health.status})${C.reset}` : `${C.red}  ♥ ${e.health.url} ناسالم (${e.health.status ?? e.health.error})${C.reset}`);
      break;
    case "summary": {
      const s = e.card;
      console.log(`\n${C.bold}── خلاصه ──${C.reset} نتیجه: ${s.outcome}${s.url ? ` · ${s.url}` : ""}${s.monthlyCostToman ? ` · ${toman(s.monthlyCostToman)}/ماه${s.pricesVerified ? "" : " (تخمینی)"}` : ""}`);
      if (s.rootCauseFa) console.log(`  ریشه‌ی مشکل: ${s.rootCauseFa}`);
      for (const f of s.fixesFa) console.log(`  اصلاح: ${f}`);
      break;
    }
    default:
      break;
  }
}

async function answer(app: ReturnType<typeof createRahandaz>, runId: string, a: ApprovalRequest) {
  console.log(`\n${C.bold}${C.yellow}┌─ درخواست تأیید: ${a.titleFa}${C.reset}`);
  console.log(`${C.yellow}│ نوع: ${a.kind}${a.dryRun ? " · DRY_RUN (اجرا نمی‌شود)" : ""} · منبع: ${a.resource}${C.reset}`);
  if (a.plan) {
    const p = a.plan;
    console.log(`│ اپ: ${p.appName} · پلتفرم: ${p.platform} · پورت: ${p.port} (${p.portSourceFa}) · پلن: ${p.plan.labelFa}`);
    console.log(`│ هزینه‌ی ماهانه: ${toman(p.monthlyCostToman)}${p.pricesVerified ? "" : " (قیمت‌ها تأییدنشده)"}${p.overBudget ? `${C.red} بیش از سقف بودجه${C.reset}` : ""}`);
    for (const w of p.warnings) console.log(`│ ⚠ ${w.messageFa}`);
    for (const act of p.actions) console.log(`│ • ${act.titleFa}`);
  }
  for (const d of a.diffs ?? []) console.log(`${C.dim}${d.diff.split("\n").map((l) => `│ ${l}`).join("\n")}${C.reset}`);
  for (const c of a.calls) console.log(`${C.dim}│ ${formatCallLine(c)}${C.reset}`);
  if (a.taintedWarningFa) console.log(`${C.yellow}│ ⚠ ${a.taintedWarningFa}${C.reset}`);

  const yes = (await ask(`└ تأیید می‌کنید؟ (y/n) `)).trim().toLowerCase();
  if (yes !== "y" && yes !== "yes" && yes !== "بله") {
    await app.runtime.resolveApproval(runId, a.id, { decision: "denied", actor: "user:cli" });
    return;
  }
  const confirmText = a.requireTypedConfirmation ? await ask(`${C.red}عملیات حساس. نام «${a.requireTypedConfirmation}» را تایپ کنید: ${C.reset}`) : undefined;
  const budgetOverride = a.requireBudgetOverride ? (await ask("از سقف بودجه عبور کند؟ (y/n) ")).trim().toLowerCase() === "y" : undefined;
  const secretValues: Record<string, string> = {};
  for (const s of a.secretInputs) secretValues[s.key] = await ask(`مقدار ${s.key} (نمایش داده نمی‌شود): `, true);
  const res = await app.runtime.resolveApproval(runId, a.id, { decision: "approved", actor: "user:cli", confirmText, budgetOverride, secretValues });
  if (!res.ok) {
    console.log(`${C.red}${res.errorFa}${C.reset}`);
    await answer(app, runId, a);
  }
}

// ── tiny prompt helper with hidden input for secrets ────────────
let rl: readline.Interface | null = null;
let muted = false;
function getRl() {
  // Output goes through a gate so hidden answers (secrets) are not echoed.
  const gate = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  rl ??= readline.createInterface({ input: process.stdin, output: gate, terminal: Boolean(process.stdin.isTTY) });
  return rl;
}
function ask(q: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(q);
    muted = hidden;
    getRl().question("", (ans) => {
      muted = false;
      if (hidden) process.stdout.write("\n");
      resolve(ans);
    });
  });
}
function rlClose() {
  rl?.close();
}

main().catch((err) => {
  console.error(`${C.red}${(err as Error).message}${C.reset}`);
  process.exit(1);
});
