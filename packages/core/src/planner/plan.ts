/**
 * Deployment planner: analysis → a concrete, priced plan whose actions are the
 * exact tool calls the agent will make. Approving the plan approves exactly
 * these calls (by fingerprint) and nothing else.
 */
import { ADDON_PRICES, smallestPlanWithRam, type AppDetails, type Plan, type Platform } from "@rahandaz/liara";
import type { AnalysisWarning, RepoAnalysis } from "../analyser/types";

export interface PlannedAction {
  tool: "create_app" | "set_env_vars" | "deploy_app";
  args: Record<string, unknown>;
  titleFa: string;
}

export interface PlanEnvVar {
  key: string;
  valueRef: string;
  secret: boolean;
  sourceFa: string;
}

export interface DeployPlan {
  id: string;
  appName: string;
  appExists: boolean;
  platform: Platform;
  port: number;
  portSourceFa: string;
  plan: Plan;
  monthlyCostToman: number;
  costLines: Array<{ labelFa: string; toman: number }>;
  pricesVerified: boolean;
  env: PlanEnvVar[];
  recommendationsFa: string[];
  url: string;
  warnings: AnalysisWarning[];
  actions: PlannedAction[];
  maxMonthlyCostToman: number;
  overBudget: boolean;
}

const PORT_SOURCE_FA: Record<RepoAnalysis["portSource"], string> = {
  "liara.json": "از liara.json",
  Dockerfile: "از EXPOSE در Dockerfile",
  code: "از کد برنامه",
  Procfile: "از Procfile",
  "platform-default": "پیش‌فرض پلتفرم در لیارا",
};

/** Liara app names: lowercase letters, digits and dashes, 3–32 chars. */
export function suggestAppName(repoName: string, suffix = ""): string {
  let base = repoName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (base.length < 3) base = `app-${base || "x"}`;
  const max = 32 - (suffix ? suffix.length + 1 : 0);
  base = base.slice(0, max).replace(/-+$/, "");
  return suffix ? `${base}-${suffix}` : base;
}

export function buildDeployPlan(input: {
  analysis: RepoAnalysis;
  appName: string;
  plans: Plan[];
  existingApp: AppDetails | null;
  appUrl: string;
  maxMonthlyCostToman: number;
  planId?: string;
}): DeployPlan {
  const { analysis, appName, plans, existingApp } = input;
  // Next.js / Laravel / Django builds need more memory than the smallest plan.
  const heavy = ["next", "laravel", "django"].includes(analysis.platform);
  const plan = (input.planId ? plans.find((p) => p.id === input.planId) : undefined) ?? smallestPlanWithRam(plans, heavy ? 1024 : 512);

  const env: PlanEnvVar[] = analysis.env
    .filter((e) => !existingApp?.envKeys.includes(e.name))
    .map((e) => ({
      key: e.name,
      valueRef: e.suggestedRef === "user" ? `user:${e.name}` : e.suggestedRef === "example" ? `example:${e.name}` : e.suggestedRef,
      secret: e.secret,
      sourceFa:
        e.suggestedRef === "user"
          ? `از ${e.source}، مقدار را شما وارد می‌کنید`
          : e.suggestedRef === "example"
            ? "مقدار نمونه‌ی همان .env.example مخزن"
            : `از ${e.source}، به‌صورت امن ساخته می‌شود`,
    }));

  const costLines = [{ labelFa: `پلن ${plan.labelFa}: ${plan.cpu} هسته، ${plan.ramMb >= 1024 ? `${plan.ramMb / 1024} گیگ` : `${plan.ramMb} مگ`} رم`, toman: plan.monthlyToman }];
  const recommendationsFa: string[] = [];
  if (analysis.database.needed) {
    recommendationsFa.push(`به دیتابیس ${analysis.database.kind} نیاز دارد (${analysis.database.evidence}). در این نسخه جدا ساخته می‌شود؛ هزینه‌ی تقریبی جدا حساب شده.`);
    costLines.push({ labelFa: `دیتابیس ${analysis.database.kind} (کوچک، پیشنهادی)`, toman: ADDON_PRICES.databaseSmallToman });
  }
  if (analysis.disk.needed) {
    recommendationsFa.push(`به دیسک ماندگار نیاز دارد (${analysis.disk.evidence}).`);
    costLines.push({ labelFa: "دیسک ۵ گیگ (پیشنهادی)", toman: 5 * ADDON_PRICES.diskPerGbToman });
  }
  const monthlyCostToman = costLines.reduce((s, l) => s + l.toman, 0);

  const actions: PlannedAction[] = [];
  if (!existingApp) {
    actions.push({ tool: "create_app", args: { name: appName, platform: analysis.platform, planId: plan.id }, titleFa: `ساخت اپ ${appName} روی پلن ${plan.labelFa}` });
  }
  if (env.length) {
    actions.push({
      tool: "set_env_vars",
      args: { app: appName, vars: env.map((e) => ({ key: e.key, valueRef: e.valueRef })) },
      titleFa: `تنظیم ${env.length} متغیر محیطی (${env.map((e) => e.key).join("، ")})`,
    });
  }
  actions.push({ tool: "deploy_app", args: { app: appName, port: analysis.port, platform: analysis.platform }, titleFa: `آپلود سورس و دیپلوی روی پورت ${analysis.port}` });

  return {
    id: `plan_${Date.now().toString(36)}`,
    appName,
    appExists: Boolean(existingApp),
    platform: analysis.platform,
    port: analysis.port,
    portSourceFa: PORT_SOURCE_FA[analysis.portSource],
    plan,
    monthlyCostToman,
    costLines,
    pricesVerified: plan.verified,
    env,
    recommendationsFa,
    url: input.appUrl,
    warnings: analysis.warnings,
    actions,
    maxMonthlyCostToman: input.maxMonthlyCostToman,
    overBudget: monthlyCostToman > input.maxMonthlyCostToman,
  };
}
