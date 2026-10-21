import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AuditLog } from "../src/audit/audit-log";
import { loadConfig } from "../src/config/config";
import { unifiedDiff } from "../src/repo/diff";
import { findRepoRef, safeJoin } from "../src/repo/workspace";
import { Redactor } from "../src/safety/redactor";
import { LiaraDocsIndex } from "../src/knowledge/docs-search";
import { breakApp } from "../src/agent/chaos";
import { makeApp, ROOT, runToEnd } from "./helpers";

describe("audit log", () => {
  it("is append-only and hash-chained; tampering is detected; secrets are redacted", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-"));
    const red = new Redactor();
    red.addSecret("super-secret-token-value");
    const log = new AuditLog(dir, red);
    log.append({ actor: "user:a", action: "approval", result: "approved", detail: "token super-secret-token-value" });
    log.append({ actor: "agent", action: "tool_call", tool: "create_app", result: "ok" });
    expect(log.verify()).toEqual({ ok: true, brokenAt: null, count: 2 });
    const file = path.join(dir, "audit", "audit.jsonl");
    expect(fs.readFileSync(file, "utf8")).not.toContain("super-secret-token-value");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"approved"', '"denied"'));
    expect(log.verify().ok).toBe(false);
  });
});

describe("config", () => {
  it("model choice: Liara AI or another OpenAI-compatible provider, the other one as fallback", () => {
    const both = { RAHANDAZ_ROOT: ROOT, LIARA_AI_BASE_URL: "https://ai.liara.ir/api/v1/ws1/", LIARA_AI_KEY: "lk-123456", LLM_BASE_URL: "https://api.other.example/v1", LLM_API_KEY: "ok-123456", LLM_MODEL: "m1" };
    const a = loadConfig(both);
    expect(a.mockLlm).toBe(false);
    expect(a.llms.map((l) => l.provider)).toEqual(["liara", "openai-compatible"]);
    expect(a.llms[0]!.baseUrl).toBe("https://ai.liara.ir/api/v1/ws1");
    expect(loadConfig({ ...both, LLM_PROVIDER: "openai-compatible" }).llms[0]!.provider).toBe("openai-compatible");
    expect(() => loadConfig({ RAHANDAZ_ROOT: ROOT, MOCK_LLM: "false" })).toThrow(/LIARA_AI/);
  });

  it("falls back to the next model when the first provider is down", async () => {
    const { FallbackProvider } = await import("../src/llm/fallback");
    const down = { name: "down", complete: async () => Promise.reject(new Error("503")) };
    const up = { name: "up", complete: async () => ({ message: { role: "assistant" as const, content: "ok" } }) };
    const r = await new FallbackProvider([down, up]).complete({ messages: [], tools: [] });
    expect(r.message.content).toBe("ok");
  });
  it("real mode is DRY_RUN by default", () => {
    expect(loadConfig({ RAHANDAZ_ROOT: ROOT, LIARA_MODE: "real", LIARA_API_TOKEN: "t" }).dryRun).toBe(true);
    expect(loadConfig({ RAHANDAZ_ROOT: ROOT }).dryRun).toBe(false);
    expect(loadConfig({ RAHANDAZ_ROOT: ROOT }).allowDestructive).toBe(false);
  });
});

describe("workspace", () => {
  it("only accepts github.com links and fixtures; paths cannot escape", () => {
    expect(findRepoRef("لطفاً https://github.com/acme/shop.git را دیپلوی کن")).toBe("https://github.com/acme/shop.git");
    expect(findRepoRef("deploy fixture:node-no-start")).toBe("fixture:node-no-start");
    expect(findRepoRef("deploy https://evil.example/acme/shop")).toBeNull();
    expect(() => safeJoin("/tmp/ws", "../etc/passwd")).toThrow();
    expect(safeJoin("/tmp/ws", "a/b.json")).toContain("b.json");
  });
});

describe("diff", () => {
  it("produces a unified diff", () => {
    const d = unifiedDiff("liara.json", '{\n  "platform": "node",\n  "port": 3000\n}\n', '{\n  "platform": "node",\n  "port": 8080\n}\n');
    expect(d).toContain("--- a/liara.json");
    expect(d).toContain('-  "port": 3000');
    expect(d).toContain('+  "port": 8080');
  });
});

describe("docs search (LiaraYar index)", () => {
  it("finds the liara.json page for a port question", async () => {
    const idx = new LiaraDocsIndex(path.join(ROOT, "data/liara-docs"));
    const hits = await idx.search("تنظیم پورت برنامه liara.json port", 3);
    expect(hits.map((h) => h.url)).toContain("https://docs.liara.ir/paas/liarajson/");
    expect(idx.info().chunks).toBeGreaterThan(3000);
  });
});

describe("break it on stage", () => {
  it("is refused without ALLOW_DESTRUCTIVE or the typed name", async () => {
    const off = makeApp();
    expect((await breakApp(off.runtime, { app: "demo-shop", scenario: "missing_env", actor: "user:judge", confirmText: "demo-shop" })).ok).toBe(false);
    const on = makeApp({ ALLOW_DESTRUCTIVE: "true" });
    expect((await breakApp(on.runtime, { app: "demo-shop", scenario: "missing_env", actor: "user:judge", confirmText: "nope" })).ok).toBe(false);
  });

  it("monitor notices, incident run diagnoses with docs and heals after one approval", async () => {
    const app = makeApp({ ALLOW_DESTRUCTIVE: "true" });
    expect(await app.monitor.tick()).toEqual([]); // baseline: healthy
    const res = await breakApp(app.runtime, { app: "demo-shop", scenario: "missing_env", actor: "user:judge", confirmText: "demo-shop" });
    expect(res).toMatchObject({ ok: true, touched: "SESSION_SECRET" });
    const [runId] = await app.monitor.tick();
    expect(runId).toBeTruthy();

    let state = await app.runtime.settled(runId!);
    expect(state.status).toBe("awaiting_approval");
    const approval = state.approvals.find((a) => a.id === state.pendingApprovalId)!;
    expect(approval.tool).toBe("set_env_vars");
    expect(approval.secretInputs).toEqual([]); // generated server-side, no typing needed
    await app.runtime.resolveApproval(runId!, approval.id, { decision: "approved", actor: "user:judge" });
    state = await app.runtime.settled(runId!);
    expect(state.summary?.outcome).toBe("healthy");
    expect(state.summary?.docs.length).toBeGreaterThan(0);
    expect((await app.liara.checkHealth("demo-shop")).ok).toBe(true);
  });

  it("wrong PORT override is diagnosed and its fix is a destructive (typed) env overwrite", async () => {
    const app = makeApp({ ALLOW_DESTRUCTIVE: "true" });
    await breakApp(app.runtime, { app: "demo-shop", scenario: "wrong_port", actor: "user:judge", confirmText: "demo-shop" });
    const run = await runToEnd(app, "چرا demo-shop از کار افتاده؟");
    const diag = app.runtime.events(run.id).find((e) => e.type === "diagnosis");
    expect(diag?.type === "diagnosis" && diag.diagnoses[0]!.rule).toBe("env_port_override");
    const approval = run.approvals.find((a) => a.tool === "set_env_vars")!;
    expect(approval.kind).toBe("destructive");
    expect(approval.requireTypedConfirmation).toBe("demo-shop");
    expect(run.summary?.outcome).toBe("healthy");
  });
});
