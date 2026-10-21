/**
 * The SRE agent (spec: "intelligent troubleshooting"): collect evidence, rank
 * probable causes, propose a fix, apply with approval, verify the result.
 */
import { describe, expect, it } from "vitest";
import type { SreReport } from "../src/sre/report";
import { analyseLogs, signature } from "../src/sre/logs";
import { breakApp } from "../src/agent/chaos";
import { makeApp, runToEnd } from "./helpers";

const lastReport = (app: ReturnType<typeof makeApp>, runId: string): SreReport[] =>
  app.runtime.events(runId).flatMap((e) => (e.type === "sre_report" ? [e.report] : []));

describe("log analysis", () => {
  it("computes HTTP error rate, latency percentiles and error clusters", () => {
    const now = Date.now();
    const lines = [
      ...Array.from({ length: 18 }, (_, i) => ({ ts: new Date(now - i * 1000).toISOString(), message: `GET /products ${i < 2 ? 500 : 200} ${100 + i}ms` })),
      { ts: new Date(now).toISOString(), message: "Error: connect ECONNREFUSED 10.10.0.5:5432" },
      { ts: new Date(now).toISOString(), message: "Error: connect ECONNREFUSED 10.10.0.7:5432" },
      { ts: new Date(now).toISOString(), message: "    at TCPConnectWrap.afterConnect (node:net:1607:16)" },
    ];
    const a = analyseLogs(lines, 30);
    expect(a.http.requests).toBe(18);
    expect(a.http.errors5xx).toBe(2);
    expect(a.http.p50Ms).toBeGreaterThan(100);
    expect(a.clusters).toHaveLength(1);
    expect(a.clusters[0]!.count).toBe(2);
    expect(signature("Error: connect ECONNREFUSED 10.10.0.5:5432")).toBe(signature("Error: connect ECONNREFUSED 10.10.0.9:3306"));
  });
});

describe("SRE agent", () => {
  it("healthy app: all checks green, nothing to fix", async () => {
    const app = makeApp();
    const run = await runToEnd(app, "یک گزارش سلامت از demo-shop بده");
    const [r] = lastReport(app, run.id);
    expect(r!.status).toBe("healthy");
    expect(r!.score).toBe(100);
    expect(r!.checks.every((c) => c.severity === "ok" || c.severity === "unknown")).toBe(true);
    expect(run.applied).toEqual([]);
  });

  it("slow site: ranks RAM first with evidence, resizes after approval (with cost delta), verifies before/after", async () => {
    const app = makeApp({ ALLOW_DESTRUCTIVE: "true" });
    await breakApp(app.runtime, { app: "demo-shop", scenario: "memory_pressure", actor: "user:judge", confirmText: "demo-shop" });
    const approvals: string[] = [];
    const run = await runToEnd(app, "سایت demo-shop خیلی کند شده، چرا؟", { approve: (tool) => (approvals.push(tool), true) });

    const [before, after] = lastReport(app, run.id);
    expect(before!.symptoms).toEqual(expect.arrayContaining(["slow", "resources"]));
    expect(before!.hypotheses[0]!.id).toBe("memory_pressure");
    expect(before!.hypotheses[0]!.evidence.join("\n")).toMatch(/heap|RAM/);
    expect(before!.hypotheses[0]!.action).toMatchObject({ tool: "resize_app", args: { app: "demo-shop", planId: "mars" } });
    expect(before!.hypotheses[0]!.docs?.length).toBeGreaterThan(0);
    expect(approvals).toEqual(["resize_app"]);
    const card = run.approvals.find((a) => a.tool === "resize_app")!;
    expect(card.titleFa).toContain("+170,000");

    expect(after!.compare?.resolved).toBe(true);
    expect(after!.compare!.scoreAfter).toBeGreaterThan(after!.compare!.scoreBefore);
    expect(run.summary?.outcome).toBe("healthy");
    expect(run.messages.at(-1)?.content).toContain("مشکل حل شد");
  });

  it("HTTP 500 from a database outage: cause found from logs, no fake fix, clear guidance + API limitation", async () => {
    const app = makeApp({ ALLOW_DESTRUCTIVE: "true" });
    await breakApp(app.runtime, { app: "demo-shop", scenario: "db_down", actor: "user:judge", confirmText: "demo-shop" });
    const run = await runToEnd(app, "demo-shop خطای 500 می‌دهد");
    const [r] = lastReport(app, run.id);
    expect(r!.symptoms).toContain("errors");
    expect(r!.hypotheses[0]!.id).toBe("upstream_unreachable");
    expect(r!.hypotheses[0]!.action).toBeNull();
    expect(r!.hypotheses[0]!.guidanceFa.length).toBeGreaterThan(0);
    expect(r!.logs.http.failingRoutes.map((f) => f.route)).toContain("/cart");
    expect(r!.limitationsFa.join(" ")).toMatch(/API لیارا/);
    expect(run.applied).toEqual([]);
    const text = run.messages.at(-1)?.content ?? "";
    expect(text).toContain("علت‌های احتمالی");
    expect(text).toContain("قابل انجام نیست");
  });

  it("crash from a removed env var: fix through SRE, verified", async () => {
    const app = makeApp({ ALLOW_DESTRUCTIVE: "true" });
    await breakApp(app.runtime, { app: "demo-shop", scenario: "missing_env", actor: "user:judge", confirmText: "demo-shop" });
    const run = await runToEnd(app, "چرا demo-shop از کار افتاده؟");
    const [before, after] = lastReport(app, run.id);
    expect(before!.status).toBe("down");
    expect(before!.hypotheses[0]!.id).toBe("missing_env");
    expect(after!.compare?.resolved).toBe(true);
  });
});

describe("periodic health check", () => {
  it("a slow (not down) app also starts an incident investigation", async () => {
    const app = makeApp({ ALLOW_DESTRUCTIVE: "true" });
    expect(await app.monitor.tick()).toEqual([]);
    await breakApp(app.runtime, { app: "demo-shop", scenario: "memory_pressure", actor: "user:judge", confirmText: "demo-shop" });
    const [runId] = await app.monitor.tick();
    expect(app.runtime.getRun(runId!)?.title).toContain("کند");
    const s = await app.runtime.settled(runId!);
    expect(s.approvals.at(-1)?.tool).toBe("resize_app");
  });
});
