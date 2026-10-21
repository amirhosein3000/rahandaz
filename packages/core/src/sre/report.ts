/**
 * The SRE agent's brain: turns raw signals (health probes, metrics, logs,
 * releases, failure diagnoses) into a report a non-expert can act on:
 *   - a traffic-light checklist (what was checked, what is OK),
 *   - the symptom (down / errors / slow / resources),
 *   - probable causes RANKED by evidence, each with the evidence itself, a
 *     plain-language explanation, and either a concrete action (which still
 *     needs approval) or step-by-step guidance when no API can do it,
 *   - what the Liara API could NOT tell us (stated, not hidden),
 *   - and, on a re-check, a before/after comparison to verify a fix.
 *
 * Pure function over signals: deterministic, fast, unit-testable. The LLM (or
 * the scripted brain) explains and drives the follow-up actions.
 */
import type { AppDetails, HealthResult, MetricsSummary, Plan, Release } from "@rahandaz/liara";
import type { Diagnosis } from "../healer/diagnose";
import type { DocHit } from "../knowledge/docs-search";
import type { LogAnalysis } from "./logs";

export type Severity = "critical" | "warning" | "ok" | "unknown";
export type Symptom = "down" | "errors" | "slow" | "resources" | "crash_loop";

export interface ProposedAction {
  tool: "resize_app" | "restart_app" | "set_env_vars" | "apply_fix";
  args: Record<string, unknown>;
  titleFa: string;
  /** Monthly cost change, Toman (+ more expensive, − cheaper). */
  costDeltaToman?: number;
}

export interface Hypothesis {
  id: string;
  titleFa: string;
  explanationFa: string;
  likelihood: number;
  evidence: string[];
  action: ProposedAction | null;
  /** Steps for the user when no API can do it. */
  guidanceFa: string[];
  docsQuery: string;
  docs?: DocHit[];
}

export interface Check {
  id: "availability" | "latency" | "errors" | "memory" | "cpu" | "restarts" | "release" | "config";
  titleFa: string;
  severity: Severity;
  detailFa: string;
}

export interface SreReport {
  app: string;
  at: string;
  status: "healthy" | "degraded" | "down";
  score: number;
  headlineFa: string;
  symptoms: Symptom[];
  checks: Check[];
  hypotheses: Hypothesis[];
  logs: LogAnalysis;
  metrics: MetricsSummary;
  health: { ok: boolean; status?: number; p50Ms: number | null; url: string };
  plan: { id: string; labelFa: string; ramMb: number; cpu: number; monthlyToman: number } | null;
  limitationsFa: string[];
  compare?: { previousAt: string; scoreBefore: number; scoreAfter: number; changesFa: string[]; resolved: boolean };
}

export interface SreSignals {
  app: AppDetails;
  health: HealthResult[];
  metrics: MetricsSummary;
  logs: LogAnalysis;
  releases: Release[];
  diagnoses: Diagnosis[];
  plans: Plan[];
  hasWorkspace: boolean;
  liaraMode: "real" | "mock";
}

const pct = (n: number) => `${Math.round(n)}٪`;

export function buildSreReport(s: SreSignals, previous?: SreReport): SreReport {
  const okProbes = s.health.filter((h) => h.ok);
  const lat = s.health.map((h) => h.latencyMs).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  const probeP50 = lat.length ? lat[Math.floor(lat.length / 2)]! : null;
  const p50 = s.logs.http.p50Ms ?? s.metrics.responseMsP50 ?? probeP50;
  const down = okProbes.length === 0 || s.app.status === "crashed" || s.app.status === "stopped";
  const plan = s.plans.find((p) => p.id === s.app.planId) ?? null;
  const memPct = s.metrics.memoryMb !== null && (s.metrics.memoryLimitMb ?? plan?.ramMb) ? (s.metrics.memoryMb / (s.metrics.memoryLimitMb ?? plan!.ramMb)) * 100 : null;
  const cpu = s.metrics.cpuPercent;
  const restarts = Math.max(s.metrics.restarts ?? 0, s.logs.restarts);
  const lastRelease = s.releases[0];
  const releaseFailed = lastRelease ? ["FAILED", "UNHEALTHY", "TIMEDOUT"].includes(lastRelease.state) : false;
  const errRate = s.logs.http.errorRate;

  // ── symptoms ──────────────────────────────────────────────────
  const symptoms: Symptom[] = [];
  if (down) symptoms.push("down");
  if (!down && errRate >= 0.02) symptoms.push("errors");
  if (!down && p50 !== null && p50 >= 800) symptoms.push("slow");
  if ((memPct ?? 0) >= 85 || (cpu ?? 0) >= 85) symptoms.push("resources");
  if (restarts >= 3) symptoms.push("crash_loop");

  // ── checks (traffic light) ────────────────────────────────────
  const checks: Check[] = [
    {
      id: "availability",
      titleFa: "در دسترس بودن",
      severity: down ? "critical" : okProbes.length < s.health.length ? "warning" : "ok",
      detailFa: down ? `آدرس اپ جواب سالم نمی‌دهد (${s.health[0]?.status ?? s.health[0]?.error ?? "بدون پاسخ"})` : `${okProbes.length} از ${s.health.length} درخواست آزمایشی موفق`,
    },
    {
      id: "latency",
      titleFa: "سرعت پاسخ",
      severity: p50 === null ? "unknown" : p50 >= 1500 ? "critical" : p50 >= 800 ? "warning" : "ok",
      detailFa: p50 === null ? "داده‌ای در دسترس نیست" : `میانه‌ی زمان پاسخ ${Math.round(p50)}ms${s.logs.http.p95Ms ? `، صدک ۹۵: ${Math.round(s.logs.http.p95Ms)}ms` : ""}`,
    },
    {
      id: "errors",
      titleFa: "خطاهای سرور",
      severity: s.logs.http.requests === 0 ? "unknown" : errRate >= 0.05 ? "critical" : errRate >= 0.01 ? "warning" : "ok",
      detailFa: s.logs.http.requests === 0 ? "در لاگ‌ها درخواستی دیده نشد" : `${s.logs.http.errors5xx} خطای ۵xx از ${s.logs.http.requests} درخواست (${pct(errRate * 100)})`,
    },
    {
      id: "memory",
      titleFa: "حافظه (RAM)",
      severity: memPct === null ? "unknown" : memPct >= 95 ? "critical" : memPct >= 85 ? "warning" : "ok",
      detailFa: memPct === null ? "داده‌ای در دسترس نیست" : `${s.metrics.memoryMb} از ${s.metrics.memoryLimitMb ?? plan?.ramMb} مگابایت (${pct(memPct)})`,
    },
    {
      id: "cpu",
      titleFa: "پردازنده (CPU)",
      severity: cpu === null ? "unknown" : cpu >= 90 ? "critical" : cpu >= 75 ? "warning" : "ok",
      detailFa: cpu === null ? "داده‌ای در دسترس نیست" : `${pct(cpu)} مصرف`,
    },
    {
      id: "restarts",
      titleFa: "ری‌استارت‌ها",
      severity: restarts >= 3 ? "critical" : restarts >= 1 ? "warning" : "ok",
      detailFa: restarts ? `${restarts} ری‌استارت/کرش اخیر${s.logs.oomKills ? `، ${s.logs.oomKills} بار به‌خاطر کمبود حافظه` : ""}` : "ری‌استارت غیرعادی دیده نشد",
    },
    {
      id: "release",
      titleFa: "آخرین ریلیز",
      severity: !lastRelease ? "unknown" : releaseFailed ? "critical" : "ok",
      detailFa: !lastRelease ? "ریلیزی پیدا نشد" : `${lastRelease.state}${lastRelease.createdAt ? ` · ${lastRelease.createdAt.slice(0, 16).replace("T", " ")}` : ""}`,
    },
    {
      id: "config",
      titleFa: "پیکربندی",
      severity: s.diagnoses.some((d) => d.rule === "missing_env" || d.rule === "missing_app_key" || d.rule === "env_port_override" || d.rule === "port_mismatch") ? "critical" : "ok",
      detailFa: s.diagnoses.find((d) => ["missing_env", "missing_app_key", "env_port_override", "port_mismatch"].includes(d.rule))?.titleFa ?? `${s.app.envKeys.length} متغیر محیطی تنظیم شده`,
    },
  ];

  // ── hypotheses, ranked by evidence ────────────────────────────
  const H: Hypothesis[] = [];
  const nextPlan = (by: "ram" | "cpu") =>
    [...s.plans].sort((a, b) => a.monthlyToman - b.monthlyToman).find((p) => (by === "ram" ? p.ramMb > (plan?.ramMb ?? 0) : p.cpu > (plan?.cpu ?? 0)));
  const resize = (target: Plan | undefined, why: string): ProposedAction | null =>
    target && plan
      ? { tool: "resize_app", args: { app: s.app.name, planId: target.id }, titleFa: `تغییر پلن از ${plan.labelFa} به ${target.labelFa} (${why})`, costDeltaToman: target.monthlyToman - plan.monthlyToman }
      : null;

  for (const d of s.diagnoses) {
    let action: ProposedAction | null = null;
    const guidance: string[] = [];
    if (d.fix?.env.length) {
      action = { tool: "set_env_vars", args: { app: s.app.name, vars: d.fix.env.map((e) => ({ key: e.key, valueRef: e.valueRef })) }, titleFa: d.fix.titleFa };
    } else if (d.fix?.files.length) {
      if (s.hasWorkspace) action = { tool: "apply_fix", args: { fixId: d.fix.id }, titleFa: d.fix.titleFa };
      else guidance.push(`این اصلاح تغییر کد است (${d.fix.titleFa})؛ لینک مخزن را بدهید تا اعمال و دوباره دیپلوی کنم.`);
    }
    H.push({ id: d.rule, titleFa: d.titleFa, explanationFa: d.explanationFa, likelihood: d.confidence, evidence: d.evidence, action, guidanceFa: guidance, docsQuery: d.docsQuery });
  }

  const dbCluster = s.logs.clusters.find((c) => /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|could not connect|connection refused|database|5432|3306|27017|6379/i.test(c.sample));
  const exceptionCluster = s.logs.clusters.find((c) => c !== dbCluster && /Error:|Exception|Traceback|TypeError|ReferenceError/i.test(c.sample) && !/heap|memory/i.test(c.sample));
  const oom = s.logs.oomKills > 0 || s.logs.clusters.some((c) => /out of memory|heap limit/i.test(c.sample));

  if (symptoms.includes("errors") || symptoms.includes("down")) {
    if (dbCluster) {
      const routes = s.logs.http.failingRoutes.map((r) => r.route).join("، ");
      H.push({
        id: "upstream_unreachable",
        titleFa: "دیتابیس یا سرویس وابسته در دسترس نیست",
        explanationFa: `صفحه‌هایی که به دیتابیس نیاز دارند${routes ? ` (${routes})` : ""} خطای ۵۰۰ می‌دهند و همزمان در لاگ «${dbCluster.sample.slice(0, 60)}» ${dbCluster.count} بار تکرار شده. یعنی خود اپ بالاست ولی به دیتابیس وصل نمی‌شود.`,
        likelihood: 0.86,
        evidence: [dbCluster.sample, ...s.logs.http.failingRoutes.slice(0, 2).map((r) => `${r.route} → ${r.status} (${r.count} بار)`)],
        action: null,
        guidanceFa: [
          "در کنسول لیارا، بخش دیتابیس‌ها، روشن بودن دیتابیس را بررسی کنید.",
          "اگر دیتابیس روی لیارا نیست، دسترسی شبکه و فایروال سرویس دیتابیس را چک کنید.",
          "متغیرهای اتصال (مثل DATABASE_URL یا DB_HOST) را با آدرس واقعی دیتابیس مقایسه کنید.",
        ],
        docsQuery: "اتصال به دیتابیس برنامه خطای ECONNREFUSED",
      });
    }
    if (exceptionCluster) {
      H.push({
        id: "app_exception",
        titleFa: "خطای کد برنامه",
        explanationFa: `یک خطای برنامه ${exceptionCluster.count} بار تکرار شده؛ احتمالاً یک باگ در کد مسیرهای خطادار است.`,
        likelihood: 0.55,
        evidence: [exceptionCluster.sample],
        action: null,
        guidanceFa: ["خط اول stack trace را در کد پیدا کنید؛ اگر بعد از آخرین ریلیز شروع شده، تغییرات همان ریلیز را بررسی کنید."],
        docsQuery: "مشاهده لاگ برنامه خطا",
      });
    }
    if (lastRelease && !releaseFailed && s.logs.clusters[0]) {
      const firstErr = s.logs.clusters.map((c) => c.firstTs).sort()[0]!;
      const deployedAt = Date.parse(lastRelease.createdAt);
      const gapMin = (Date.parse(firstErr) - deployedAt) / 60_000;
      if (Number.isFinite(gapMin) && gapMin >= 0 && gapMin <= 30) {
        H.push({
          id: "recent_release",
          titleFa: "خطاها بعد از آخرین ریلیز شروع شده‌اند",
          explanationFa: `اولین خطا حدود ${Math.round(gapMin)} دقیقه بعد از ریلیز ${lastRelease.id} دیده شد.`,
          likelihood: 0.5,
          evidence: [`ریلیز ${lastRelease.id}: ${lastRelease.createdAt}`, `اولین خطا: ${firstErr}`],
          action: null,
          guidanceFa: ["API لیارا برگرداندن ریلیز (rollback) ندارد؛ از بخش «ریلیزها» در کنسول لیارا ریلیز قبلی را فعال کنید، یا اصلاح را دیپلوی کنید."],
          docsQuery: "مدیریت ریلیزها برنامه",
        });
      }
    }
  }

  if (symptoms.includes("slow") || symptoms.includes("resources") || oom) {
    if ((memPct ?? 0) >= 85 || oom) {
      H.push({
        id: "memory_pressure",
        titleFa: "حافظه‌ی پلن پر شده است",
        explanationFa: `مصرف RAM ${memPct !== null ? pct(memPct) : "بالا"} از سقف پلن است${oom ? " و برنامه به‌خاطر کمبود حافظه کرش کرده" : ""}. وقتی حافظه پر می‌شود، زمان صرف پاک‌سازی حافظه می‌شود و پاسخ‌ها کند و گاهی ۵۰۲ می‌شوند.`,
        likelihood: Math.min(0.95, 0.5 + ((memPct ?? 85) >= 95 ? 0.15 : 0) + (oom ? 0.25 : 0) + (symptoms.includes("slow") ? 0.05 : 0)),
        evidence: [
          `RAM: ${s.metrics.memoryMb} از ${s.metrics.memoryLimitMb ?? plan?.ramMb} مگابایت`,
          ...s.logs.clusters.filter((c) => /heap|memory|GC|OOM/i.test(c.sample)).slice(0, 2).map((c) => `${c.sample.slice(0, 120)} (×${c.count})`),
        ],
        action: resize(nextPlan("ram"), "حافظه‌ی بیشتر"),
        guidanceFa: ["اگر مصرف حافظه با گذشت زمان مدام بالا می‌رود، احتمال نشت حافظه (memory leak) در کد را هم بررسی کنید."],
        docsQuery: "انتخاب بهترین پلن برای برنامه با استفاده از گزارشات سخت‌افزاری",
      });
    }
    if ((cpu ?? 0) >= 85) {
      H.push({
        id: "cpu_saturation",
        titleFa: "پردازنده به سقف پلن رسیده",
        explanationFa: `مصرف CPU ${pct(cpu!)} است؛ درخواست‌ها پشت هم صف می‌شوند و کند پاسخ داده می‌شوند.`,
        likelihood: 0.7,
        evidence: [`CPU: ${pct(cpu!)}`],
        action: resize(nextPlan("cpu"), "پردازنده‌ی بیشتر"),
        guidanceFa: [],
        docsQuery: "انتخاب بهترین پلن برای برنامه با استفاده از گزارشات سخت‌افزاری",
      });
    }
    if (symptoms.includes("slow") && !H.some((h) => h.id === "memory_pressure" || h.id === "cpu_saturation")) {
      const slow = s.logs.http.slowest[0];
      H.push({
        id: "slow_code_path",
        titleFa: "منابع مشکلی ندارند؛ کندی از کد یا وابستگی‌هاست",
        explanationFa: `RAM و CPU در حد عادی‌اند ولی ${slow ? `مسیر ${slow.route} با میانه‌ی ${Math.round(slow.p50Ms)}ms` : "بعضی مسیرها"} کند است؛ معمولاً کوئری سنگین دیتابیس یا فراخوانی سرویس بیرونی.`,
        likelihood: 0.45,
        evidence: s.logs.http.slowest.map((r) => `${r.route}: ${Math.round(r.p50Ms)}ms (${r.count} درخواست)`),
        action: null,
        guidanceFa: ["کوئری‌های این مسیر را بررسی کنید (ایندکس، N+1)", "برای داده‌های تکراری از کش استفاده کنید"],
        docsQuery: "افزایش سرعت برنامه کش",
      });
    }
  }

  if (symptoms.includes("crash_loop") && !H.length) {
    H.push({
      id: "crash_loop",
      titleFa: "برنامه مدام کرش و ری‌استارت می‌شود",
      explanationFa: `${restarts} ری‌استارت اخیر دیده شد ولی علت مشخصی در لاگ پیدا نشد.`,
      likelihood: 0.4,
      evidence: s.logs.clusters.slice(0, 2).map((c) => c.sample),
      action: { tool: "restart_app", args: { app: s.app.name }, titleFa: `ری‌استارت ${s.app.name}` },
      guidanceFa: ["اگر بعد از ری‌استارت دوباره تکرار شد، لاگ لحظه‌ی کرش را بررسی کنید."],
      docsQuery: "ری‌استارت برنامه",
    });
  }

  // Cost: a healthy app far below its plan can save money (suggestion only).
  if (!symptoms.length && plan && memPct !== null && memPct < 25 && (cpu ?? 100) < 10) {
    const smaller = [...s.plans].filter((p) => p.monthlyToman < plan.monthlyToman && p.ramMb > (s.metrics.memoryMb ?? 0) * 2).sort((a, b) => b.monthlyToman - a.monthlyToman)[0];
    if (smaller) {
      H.push({
        id: "oversized_plan",
        titleFa: "پلن بزرگ‌تر از نیاز است",
        explanationFa: `مصرف RAM ${pct(memPct)} و CPU ${pct(cpu ?? 0)} است؛ با پلن ${smaller.labelFa} هم کار می‌کند و ماهانه ${plan.monthlyToman - smaller.monthlyToman} تومان کمتر می‌پردازید.`,
        likelihood: 0.6,
        evidence: [`RAM ${pct(memPct)}`, `CPU ${pct(cpu ?? 0)}`],
        action: resize(smaller, "صرفه‌جویی"),
        guidanceFa: [],
        docsQuery: "انتخاب بهترین پلن برای برنامه با استفاده از گزارشات سخت‌افزاری",
      });
    }
  }

  H.sort((a, b) => b.likelihood - a.likelihood);

  // ── score, status, headline ───────────────────────────────────
  let score = 100;
  if (down) score -= 60;
  if (errRate >= 0.05) score -= 25;
  else if (errRate >= 0.01) score -= 10;
  if (p50 !== null && p50 >= 1500) score -= 20;
  else if (p50 !== null && p50 >= 800) score -= 10;
  if ((memPct ?? 0) >= 95) score -= 15;
  else if ((memPct ?? 0) >= 85) score -= 8;
  if ((cpu ?? 0) >= 90) score -= 10;
  if (restarts >= 3) score -= 10;
  if (releaseFailed) score -= 10;
  score = Math.max(0, Math.min(100, score));
  const status: SreReport["status"] = down ? "down" : symptoms.length ? "degraded" : "healthy";

  const top = H[0];
  const symptomFa = down ? "اپ از دسترس خارج است" : symptoms.includes("errors") ? "اپ خطای ۵۰۰ می‌دهد" : symptoms.includes("slow") ? "اپ کند است" : symptoms.includes("resources") ? "منابع اپ رو به اتمام است" : "اپ سالم است";
  const headlineFa = top && status !== "healthy" ? `${symptomFa}؛ محتمل‌ترین علت: ${top.titleFa}.` : top ? `${symptomFa}. پیشنهاد: ${top.titleFa}.` : `${symptomFa}؛ مشکلی پیدا نشد.`;

  // ── what the API could not tell us ────────────────────────────
  const limitationsFa = [
    "API لیارا متریک «زمان پاسخ» ندارد؛ زمان پاسخ را از لاگ درخواست‌ها و چند درخواست آزمایشی به آدرس اپ اندازه گرفتیم.",
  ];
  if (s.metrics.cpuPercent === null || s.metrics.memoryMb === null) limitationsFa.push("API لیارا برای این اپ متریک CPU یا RAM برنگرداند؛ آن بخش‌ها «نامشخص» علامت خورده‌اند.");
  if (H.some((h) => h.id === "recent_release" || h.id === "upstream_unreachable")) limitationsFa.push("API لیارا برگرداندن ریلیز قبلی (rollback) را ندارد؛ این کار از کنسول لیارا انجام می‌شود.");
  if (H.some((h) => h.id === "upstream_unreachable")) limitationsFa.push("وضعیت داخلی دیتابیس‌های بیرون از لیارا از اینجا قابل مشاهده نیست.");
  if (s.liaraMode === "mock") limitationsFa.push("این گزارش روی لیارای شبیه‌سازی‌شده ساخته شده است.");

  const report: SreReport = {
    app: s.app.name,
    at: new Date().toISOString(),
    status,
    score,
    headlineFa,
    symptoms,
    checks,
    hypotheses: H,
    logs: s.logs,
    metrics: s.metrics,
    health: { ok: !down, status: s.health[0]?.status, p50Ms: probeP50, url: s.health[0]?.url ?? "" },
    plan: plan ? { id: plan.id, labelFa: plan.labelFa, ramMb: plan.ramMb, cpu: plan.cpu, monthlyToman: plan.monthlyToman } : null,
    limitationsFa,
  };
  if (previous) report.compare = compareReports(previous, report);
  return report;
}

/** Before/after: did the corrective action work? */
export function compareReports(before: SreReport, after: SreReport): NonNullable<SreReport["compare"]> {
  const changes: string[] = [];
  const b = Object.fromEntries(before.checks.map((c) => [c.id, c]));
  for (const c of after.checks) {
    const prev = b[c.id];
    if (prev && prev.severity !== c.severity) changes.push(`${c.titleFa}: ${prev.detailFa} ← ${c.detailFa}`);
  }
  const resolved = after.status === "healthy" || (after.score >= 90 && after.score > before.score);
  return { previousAt: before.at, scoreBefore: before.score, scoreAfter: after.score, changesFa: changes, resolved };
}
