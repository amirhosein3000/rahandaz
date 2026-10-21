/**
 * End-to-end demo flow in mock mode, for every fixture:
 * link → analysis → plan (approve) → deploy → failure → diagnosis + docs → fix (approve) → redeploy → healthy.
 */
import { describe, expect, it } from "vitest";
import { makeApp, runToEnd, toolsCalled } from "./helpers";

const CASES: Array<{ fixture: string; rule: string | null; via: "apply_fix" | "set_env_vars" | null }> = [
  { fixture: "node-wrong-port", rule: "port_mismatch", via: "apply_fix" },
  { fixture: "node-no-start", rule: "missing_start_script", via: "apply_fix" },
  { fixture: "next-missing-env", rule: "missing_env", via: "set_env_vars" },
  { fixture: "python-unpinned", rule: "unpinned_dependency", via: "apply_fix" },
  { fixture: "laravel-no-appkey", rule: "missing_app_key", via: "set_env_vars" },
  { fixture: "docker-bad-base", rule: "bad_base_image", via: "apply_fix" },
  { fixture: "demo-shop", rule: null, via: null },
];

describe("demo flow (mock Liara + scripted brain)", () => {
  for (const c of CASES) {
    it(`${c.fixture}: ends healthy${c.rule ? ` after fixing ${c.rule}` : " on the first try"}`, async () => {
      const app = makeApp();
      const run = await runToEnd(app, `این را روی لیارا دیپلوی کن: https://github.com/acme/${c.fixture}`, {});
      const tools = toolsCalled(app, run.id);

      expect(run.status).toBe("completed");
      expect(run.summary?.outcome).toBe("healthy");
      expect(tools.slice(0, 3)).toEqual(["acquire_repo", "analyse_repo", "propose_deploy_plan"]);
      if (c.rule) {
        expect(run.diagnoses.length + run.healAttempts).toBeGreaterThan(0);
        const diagEvents = app.runtime.events(run.id).filter((e) => e.type === "diagnosis");
        expect(diagEvents[0]?.type === "diagnosis" && diagEvents[0].diagnoses[0]?.rule).toBe(c.rule);
        expect(tools).toContain("search_liara_docs");
        expect(tools).toContain(c.via!);
        expect(run.summary?.docs.length).toBeGreaterThan(0);
      } else {
        expect(tools).not.toContain("diagnose_failure");
      }
    });
  }

  it("node-wrong-port: the plan, the fix diff and the README injection all surface", async () => {
    const app = makeApp();
    const run = await runToEnd(app, "https://github.com/acme/node-wrong-port");
    const events = app.runtime.events(run.id);
    const approvalTools = events.flatMap((e) => (e.type === "approval_required" ? [e.approval.tool] : []));
    expect(approvalTools).toEqual(["propose_deploy_plan", "apply_fix"]);
    const fixApproval = events.find((e) => e.type === "approval_required" && e.approval.tool === "apply_fix");
    expect(fixApproval?.type === "approval_required" && fixApproval.approval.diffs?.[0]?.diff).toContain('+  "port": 8080');
    expect(events.some((e) => e.type === "injection_warning" && e.source === "README.md")).toBe(true);
    expect(run.summary?.ignoredInjection).toBe(true);
    // The planted instruction asked for deletions: none were even attempted.
    expect(toolsCalled(app, run.id)).not.toContain("delete_app");
    expect(run.summary?.url).toBe("https://node-wrong-port.liara.run");
  });

  it("denying the plan changes nothing", async () => {
    const app = makeApp();
    const run = await runToEnd(app, "https://github.com/acme/node-no-start", { approve: () => false });
    expect(run.status).toBe("completed");
    expect(toolsCalled(app, run.id)).not.toContain("create_app");
    expect(await app.liara.getApp("node-no-start")).toBeNull();
  });

  it("DRY_RUN plans and shows calls but creates nothing", async () => {
    const app = makeApp({ DRY_RUN: "true" });
    const run = await runToEnd(app, "https://github.com/acme/node-no-start");
    expect(run.summary?.outcome).toBe("dry_run");
    expect(await app.liara.getApp("node-no-start")).toBeNull();
    expect((await app.liara.listApps()).map((a) => a.name)).toEqual(["demo-shop"]);
    const dry = app.runtime.events(run.id).filter((e) => e.type === "tool_result" && e.dryRun);
    expect(dry.length).toBeGreaterThanOrEqual(2);
    expect(run.messages.at(-1)?.content).toContain("POST /v2/projects/");
  });

  it("budget guard: plan over MAX_MONTHLY_COST needs explicit override", async () => {
    const app = makeApp({ MAX_MONTHLY_COST: "1000" });
    const run = app.runtime.startRun({ message: "https://github.com/acme/demo-shop" });
    const state = await app.runtime.settled(run.id);
    const approval = state.approvals.find((a) => a.id === state.pendingApprovalId)!;
    expect(approval.requireBudgetOverride).toBe(true);
    const res = await app.runtime.resolveApproval(run.id, approval.id, { decision: "approved", actor: "user:test", secretValues: {} });
    expect(res.ok).toBe(false);
    expect(res.errorFa).toContain("بودجه");
    const ok = await app.runtime.resolveApproval(run.id, approval.id, { decision: "approved", actor: "user:test", budgetOverride: true, secretValues: {} });
    expect(ok.ok).toBe(true);
  });
});
