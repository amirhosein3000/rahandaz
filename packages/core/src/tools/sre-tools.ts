import type { HealthResult, MetricsSummary, Release } from "@rahandaz/liara";
import { z } from "zod";
import { diagnose } from "../healer/diagnose";
import { analyseLogs } from "../sre/logs";
import { buildSreReport } from "../sre/report";
import { defineTool, type ToolContext } from "./types";

const LOG_WINDOW_MIN = 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const instant = (ctx: ToolContext) => ctx.liara.mode === "mock" && ctx.config.mockLatencyScale === 0;

async function probe(ctx: ToolContext, app: string): Promise<HealthResult[]> {
  // Three probes: one slow answer is noise, three is a pattern.
  return Promise.all([0, 1, 2].map(() => ctx.liara.checkHealth(app)));
}

export const sreCheckTool = defineTool({
  name: "sre_check",
  description:
    "SRE investigation of one app (read-only): probes the URL, reads CPU/RAM/restarts, analyses the last 30 minutes of logs (HTTP error rate, latency, error clusters), checks recent releases and known failure patterns, then returns probable causes RANKED by evidence, each with a proposed action (still needs approval) or step-by-step guidance, plus what the Liara API could not tell. Call it again after a fix with afterChange=true to verify: the result then includes a before/after comparison.",
  kind: "read",
  timeoutMs: 120_000,
  schema: z.object({
    app: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
    afterChange: z.boolean().optional().describe("true when verifying a fix: waits up to 60s for the app to settle first"),
  }),
  titleFa: (a) => (a.afterChange ? `بررسی دوباره‌ی ${a.app} بعد از اصلاح` : `بررسی SRE اپ ${a.app}`),
  async execute(a, ctx) {
    const app = await ctx.liara.getApp(a.app);
    if (!app) return { ok: false, summaryFa: `اپ ${a.app} پیدا نشد`, error: "app not found" };
    ctx.run.appName ??= a.app;

    let health = await probe(ctx, a.app);
    if (a.afterChange && !instant(ctx)) {
      const deadline = Date.now() + 60_000;
      while (!health.some((h) => h.ok) && Date.now() < deadline) {
        await sleep(4000);
        health = await probe(ctx, a.app);
      }
    }
    const since = Math.floor(Date.now() / 1000) - LOG_WINDOW_MIN * 60;
    const [metrics, logs, releases, plans] = await Promise.all([
      ctx.liara.getMetrics(a.app).catch((): MetricsSummary => ({ cpuPercent: null, memoryMb: null, memoryLimitMb: null, restarts: null, responseMsP50: null })),
      ctx.liara.getAppLogs(a.app, since).catch(() => []),
      ctx.liara.listReleases(a.app).catch((): Release[] => []),
      ctx.liara.listPlans(),
    ]);
    // Old errors are history, not the present: after a fix, judge only by what happened since the fix;
    // with a healthy (READY) newest release, only by that release's logs (a replaced broken release's crash
    // lines would otherwise re-diagnose a problem that is already fixed).
    const fixAt = a.afterChange ? Date.parse(ctx.run.applied.at(-1)?.ts ?? "") : NaN;
    const releaseAt = releases[0]?.state === "READY" ? Date.parse(releases[0].createdAt) : NaN;
    const from = Math.max(Number.isFinite(fixAt) ? fixAt : -Infinity, Number.isFinite(releaseAt) ? releaseAt : -Infinity);
    const window = Number.isFinite(from) ? logs.filter((l) => Date.parse(l.ts) >= from) : logs;
    const failed = releases.find((r) => ["FAILED", "UNHEALTHY"].includes(r.state));
    const buildLines = failed && failed.id === releases[0]?.id ? (await ctx.liara.getBuildLogs(failed.id).catch(() => [])).map((l) => l.line) : [];
    const diagnoses = diagnose({
      buildLines,
      appLogs: window.map((l) => l.message),
      releaseState: releases[0]?.state,
      releasePort: releases[0]?.port,
      health: health[0] ?? null,
      analysis: ctx.run.analysis,
      workspaceDir: ctx.run.workspace?.dir ?? null,
      appEnvKeys: app.envKeys,
      platform: app.platform,
    }).filter((d) => d.rule !== "crash_unknown" && d.rule !== "http_5xx");
    for (const d of diagnoses) if (d.fix) ctx.run.fixes[d.fix.id] = d.fix;

    const report = buildSreReport(
      {
        app,
        health,
        metrics,
        logs: analyseLogs(window.map((l) => ({ ts: l.ts, message: l.message })), LOG_WINDOW_MIN),
        releases,
        diagnoses,
        plans,
        hasWorkspace: Boolean(ctx.run.workspace),
        liaraMode: ctx.liara.mode,
      },
      a.afterChange ? ctx.run.sreReports[a.app] : undefined,
    );

    // Ground the top causes in Liara's own docs.
    for (const h of report.hypotheses.slice(0, 2)) {
      // App-level causes cite platform (PaaS) pages; only a database cause may cite database pages.
      const sections = h.id === "upstream_unreachable" ? ["paas", "dbaas"] : ["paas", "references"];
      h.docs = await ctx.docs.search(h.docsQuery, 1, { platform: app.platform, sections }).catch(() => []);
      for (const d of h.docs) if (!ctx.run.docsCited.some((x) => x.url === d.url)) ctx.run.docsCited.push(d);
    }
    if (!a.afterChange || !ctx.run.sreReports[a.app]) ctx.run.sreReports[a.app] = report;
    ctx.run.lastHealthOk = report.status !== "down" && (a.afterChange ? report.compare?.resolved ?? report.status === "healthy" : report.status === "healthy");
    if (window.length) ctx.emit({ type: "log", source: "app", lines: window.slice(-60).map((l) => l.message) });
    if (diagnoses.length) ctx.emit({ type: "diagnosis", diagnoses });
    ctx.emit({ type: "sre_report", report });

    return {
      ok: true,
      summaryFa: report.compare
        ? `امتیاز سلامت: ${report.compare.scoreBefore} ← ${report.compare.scoreAfter}${report.compare.resolved ? " (مشکل حل شد)" : ""}`
        : `امتیاز سلامت ${report.score}/۱۰۰ · ${report.headlineFa}`,
      data: {
        app: report.app,
        status: report.status,
        score: report.score,
        headlineFa: report.headlineFa,
        symptoms: report.symptoms,
        checks: report.checks.map((c) => ({ id: c.id, severity: c.severity, detailFa: c.detailFa })),
        hypotheses: report.hypotheses.map((h) => ({
          id: h.id,
          titleFa: h.titleFa,
          explanationFa: h.explanationFa,
          likelihood: Number(h.likelihood.toFixed(2)),
          action: h.action,
          guidanceFa: h.guidanceFa,
          docs: h.docs?.map((d) => ({ title: d.title, url: d.url })),
        })),
        limitationsFa: report.limitationsFa,
        compare: report.compare,
      },
      untrusted: [
        { source: "app_log" as const, label: `${a.app} error clusters`, text: report.logs.clusters.map((c) => `${c.sample} (x${c.count})`).join("\n") },
        { source: "app_log" as const, label: "evidence", text: report.hypotheses.flatMap((h) => h.evidence).join("\n") },
      ],
    };
  },
});
