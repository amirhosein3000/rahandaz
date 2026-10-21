import crypto from "node:crypto";
import path from "node:path";
import { LiaraRequests } from "@rahandaz/liara";
import { z } from "zod";
import { analyseRepo } from "../analyser/analyse";
import { applyFilePatches } from "../healer/diagnose";
import { buildDeployPlan, suggestAppName } from "../planner/plan";
import { acquireRepo, findRepoRef } from "../repo/workspace";
import { fingerprint } from "../policy/fingerprint";
import { defineTool, type ToolContext } from "./types";

export const acquireRepoTool = defineTool({
  name: "acquire_repo",
  description:
    "Clone a public GitHub repository (https://github.com/<owner>/<repo>) or load a demo fixture (fixture:<name>) into this run's private working copy. Read-only for the user's resources.",
  kind: "read",
  schema: z.object({ source: z.string().min(3).max(300).describe("GitHub URL or fixture:<name>") }),
  titleFa: (a) => `دریافت مخزن ${a.source}`,
  async execute(args, ctx) {
    const ref = findRepoRef(args.source) ?? args.source;
    const ws = await acquireRepo(ref, {
      fixturesDir: ctx.config.fixturesDir,
      workspacesDir: path.join(ctx.config.dataDir, "workspaces"),
      runId: ctx.run.id,
      mapGithubToFixtures: ctx.config.liaraMode === "mock",
    });
    ctx.run.workspace = ws;
    return {
      ok: true,
      summaryFa: ws.kind === "fixture" ? `مخزن ${ws.name} آماده شد (نمونه‌ی محلی)` : `مخزن ${ws.origin} کلون شد${ws.commit ? ` (${ws.commit})` : ""}`,
      data: { name: ws.name, origin: ws.origin, kind: ws.kind, commit: ws.commit },
    };
  },
});

export const analyseRepoTool = defineTool({
  name: "analyse_repo",
  description:
    "Analyse the working copy with deterministic detectors: platform, framework, port (and where it came from), build/start commands, env var NAMES (never values), database/disk needs, risks and any instruction-like text found in files.",
  kind: "read",
  schema: z.object({}),
  titleFa: () => "تحلیل مخزن",
  async execute(_args, ctx) {
    const ws = requireWorkspace(ctx);
    const analysis = analyseRepo(ws.dir);
    ctx.run.analysis = analysis;
    ctx.emit({ type: "analysis", analysis, repo: ws.origin });
    if (analysis.injection.length) {
      ctx.run.tainted = true;
      for (const inj of analysis.injection) ctx.emit({ type: "injection_warning", source: inj.file, findings: inj.findings });
      ctx.audit.append({ actor: "system", action: "injection_detected", runId: ctx.run.id, result: "info", detail: analysis.injection.map((i) => `${i.file}: ${i.findings.map((f) => f.rule).join(",")}`).join("; ") });
    }
    const { injection, ...rest } = analysis;
    return {
      ok: true,
      summaryFa: `${analysis.stackLabel} روی پلتفرم ${analysis.platform}، پورت ${analysis.port}${analysis.warnings.length ? `، ${analysis.warnings.length} ریسک` : ""}`,
      data: { ...rest, injection: injection.map((i) => ({ file: i.file, rules: i.findings.map((f) => f.rule) })) },
      untrusted: injection.flatMap((i) => i.findings.map((f) => ({ source: "repo_file" as const, label: i.file, text: f.excerpt }))),
    };
  },
});

export const proposeDeployPlanTool = defineTool({
  name: "propose_deploy_plan",
  description:
    "Build the deployment plan from the latest analysis (app name, plan size, env vars, port, monthly cost, exact actions) and ask the user to approve it. Nothing changes until the user approves. On approval, exactly the listed actions are pre-approved; call them next with the same arguments.",
  kind: "plan",
  schema: z.object({
    appName: z.string().regex(/^[a-z0-9][a-z0-9-]{2,31}$/).optional(),
    planId: z.string().max(40).optional(),
  }),
  titleFa: () => "پیشنهاد نقشه‌ی استقرار",
  resource: (a, ctx) => a.appName ?? ctx.run.plan?.appName ?? ctx.run.workspace?.name ?? "app",
  async approvalExtras(args, ctx) {
    const analysis = ctx.run.analysis;
    const ws = requireWorkspace(ctx);
    if (!analysis) throw new Error("analyse_repo must run before propose_deploy_plan");
    const suffix = ctx.config.liaraMode === "real" ? crypto.randomBytes(2).toString("hex") : "";
    const appName = args.appName ?? suggestAppName(ws.name, suffix);
    const existing = await ctx.liara.getApp(appName);
    const plans = await ctx.liara.listPlans();
    const plan = buildDeployPlan({
      analysis,
      appName,
      plans,
      existingApp: existing,
      appUrl: ctx.liara.appUrl(appName),
      maxMonthlyCostToman: ctx.config.maxMonthlyCostToman,
      planId: args.planId,
    });
    ctx.run.plan = plan;
    ctx.emit({ type: "plan", plan });
    const calls = plan.actions.flatMap((a) => {
      if (a.tool === "create_app") return [LiaraRequests.createApp({ name: appName, platform: plan.platform, planId: plan.plan.id })];
      if (a.tool === "set_env_vars") return [LiaraRequests.updateEnvs(appName, plan.env.map((e) => e.key))];
      return LiaraRequests.deploy({ app: appName, sourceDir: ws.dir, port: plan.port, platform: plan.platform });
    });
    return {
      resource: appName,
      plan,
      calls,
      monthlyCostToman: plan.monthlyCostToman,
      requireBudgetOverride: plan.overBudget,
      secretInputs: plan.env
        .filter((e) => e.valueRef.startsWith("user:") && !ctx.vault.hasUserValue(e.key))
        .map((e) => ({ key: e.key, labelFa: e.sourceFa })),
    };
  },
  async onApproved(_args, ctx, approval) {
    const plan = ctx.run.plan;
    if (!plan) return;
    for (const action of plan.actions) ctx.run.approved[fingerprint(action.tool, action.args)] = approval.id;
    ctx.run.appName = plan.appName;
  },
  async execute(_args, ctx) {
    const plan = ctx.run.plan;
    if (!plan) return { ok: false, summaryFa: "نقشه‌ای ساخته نشده", error: "no plan" };
    return {
      ok: true,
      summaryFa: `نقشه تأیید شد: ${plan.actions.length} اقدام`,
      data: {
        approved: true,
        appName: plan.appName,
        url: plan.url,
        port: plan.port,
        platform: plan.platform,
        monthlyCostToman: plan.monthlyCostToman,
        actions: plan.actions.map((a) => ({ tool: a.tool, args: a.args })),
        note: "Call these actions next, in order, with exactly these arguments.",
      },
    };
  },
});

export const applyFixTool = defineTool({
  name: "apply_fix",
  description:
    "Apply the file changes of a fix proposed by diagnose_failure (by fixId) to the working copy. Requires user approval of the shown diff. Env changes in a fix are applied with set_env_vars instead.",
  kind: "mutating",
  schema: z.object({ fixId: z.string().min(3).max(60) }),
  titleFa: (a) => `اعمال اصلاح ${a.fixId}`,
  resource: (_a, ctx) => ctx.run.appName ?? ctx.run.workspace?.name ?? "workspace",
  plannedCalls: () => [{ method: "PATCH", path: "<working copy>", note: "local file change only; deployed by the next deploy_app" }],
  async approvalExtras(args, ctx) {
    const fix = ctx.run.fixes[args.fixId];
    if (!fix) throw new Error(`unknown fixId ${args.fixId}`);
    const redeploy = redeployFor(ctx, fix.redeploy, fix.port);
    return {
      titleFa: redeploy ? `${fix.titleFa} و دیپلوی دوباره` : fix.titleFa,
      diffs: fix.files.map((f) => ({ path: f.path, diff: f.diff })),
      calls: [
        { method: "PATCH", path: fix.files.map((f) => f.path).join(", "), note: "local working copy" },
        ...(redeploy ? LiaraRequests.deploy({ ...(redeploy.args as { app: string; port: number; platform: string }), sourceDir: "" }) : []),
      ],
    };
  },
  async onApproved(args, ctx, approval) {
    // One approval covers the fix and the exact redeploy that ships it (shown on the same card).
    const fix = ctx.run.fixes[args.fixId];
    const redeploy = fix ? redeployFor(ctx, fix.redeploy, fix.port) : null;
    if (redeploy) ctx.run.approved[fingerprint("deploy_app", redeploy.args)] = approval.id;
  },
  async execute(args, ctx) {
    const fix = ctx.run.fixes[args.fixId];
    if (!fix) return { ok: false, summaryFa: "اصلاح پیدا نشد", error: `unknown fixId ${args.fixId}` };
    if (!fix.files.length) return { ok: false, summaryFa: "این اصلاح تغییر فایلی ندارد", error: "fix has no file changes; use set_env_vars for its env part" };
    if (ctx.run.appliedFixes.length >= ctx.config.maxHealAttempts) {
      return { ok: false, summaryFa: `سقف ${ctx.config.maxHealAttempts} تلاش برای اصلاح پر شد`, error: "heal attempt limit reached; stop and report to the user" };
    }
    applyFilePatches(requireWorkspace(ctx).dir, fix.files);
    ctx.run.appliedFixes.push(fix.id);
    return {
      ok: true,
      summaryFa: fix.titleFa,
      data: { applied: fix.id, files: fix.files.map((f) => f.path), redeploy: fix.redeploy, port: fix.port ?? null, env: fix.env },
    };
  },
});

/** The deploy_app call that ships a fix, if the fix needs one: same app/platform, fixed port. */
export function redeployFor(ctx: ToolContext, needed: boolean, port?: number): { args: Record<string, unknown> } | null {
  const last = [...ctx.run.releases].reverse()[0];
  const app = ctx.run.appName ?? last?.app;
  const platform = ctx.run.analysis?.platform;
  if (!needed || !app || !platform || !ctx.run.workspace) return null;
  const p = port ?? last?.port ?? ctx.run.analysis?.port;
  return p ? { args: { app, port: p, platform } } : null;
}

function requireWorkspace(ctx: ToolContext) {
  if (!ctx.run.workspace) throw new Error("no repository loaded; call acquire_repo first");
  return ctx.run.workspace;
}
