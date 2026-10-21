import { describe, expect, it } from "vitest";
import type { ApprovalRequest } from "../src/agent/types";
import { evaluatePolicy, validateResolution, type PolicyInput } from "../src/policy/policy";
import { canonicalJson, fingerprint } from "../src/policy/fingerprint";
import { appAllowed } from "../src/config/config";

const base = (over: Partial<PolicyInput> = {}): PolicyInput => ({
  tool: "create_app",
  kind: "mutating",
  resource: "shop",
  fingerprint: "fp1",
  monthlyCostToman: 100,
  run: { approved: {}, approvals: [] },
  config: { allowDestructive: false, allowedApps: ["*"], maxMonthlyCostToman: 1000 },
  ...over,
});

const approval = (over: Partial<ApprovalRequest>): ApprovalRequest => ({
  id: "apr_1",
  runId: "r",
  toolCallId: "c",
  tool: "create_app",
  titleFa: "",
  kind: "mutating",
  resource: "shop",
  args: {},
  calls: [],
  secretInputs: [],
  dryRun: false,
  status: "approved",
  createdAt: "",
  ...over,
});

describe("policy layer", () => {
  it("read-only tools execute without approval", () => {
    expect(evaluatePolicy(base({ kind: "read" })).action).toBe("execute");
  });

  it("mutating tools never execute without an approval record", () => {
    const d = evaluatePolicy(base());
    expect(d.action).toBe("ask");
  });

  it("an approval bound to the exact fingerprint lets the call execute", () => {
    const d = evaluatePolicy(base({ run: { approved: { fp1: "apr_1" }, approvals: [approval({})] } }));
    expect(d).toMatchObject({ action: "execute", viaApproval: "apr_1" });
  });

  it("an approval for different args does not cover this call", () => {
    const d = evaluatePolicy(base({ fingerprint: "fp2", run: { approved: { fp1: "apr_1" }, approvals: [approval({})] } }));
    expect(d.action).toBe("ask");
  });

  it("a pending or denied approval record does not count", () => {
    for (const status of ["pending", "denied"] as const) {
      const d = evaluatePolicy(base({ run: { approved: { fp1: "apr_1" }, approvals: [approval({ status })] } }));
      expect(d.action).toBe("ask");
    }
  });

  it("destructive tools are blocked entirely unless ALLOW_DESTRUCTIVE=true", () => {
    const d = evaluatePolicy(base({ tool: "delete_app", kind: "destructive", run: { approved: { fp1: "apr_1" }, approvals: [approval({ kind: "destructive" })] } }));
    expect(d.action).toBe("block");
  });

  it("with ALLOW_DESTRUCTIVE, destructive tools need a typed confirmation naming the resource", () => {
    const d = evaluatePolicy(base({ tool: "delete_app", kind: "destructive", config: { allowDestructive: true, allowedApps: ["*"], maxMonthlyCostToman: 1000 } }));
    expect(d).toMatchObject({ action: "ask", requireTypedConfirmation: "shop" });
  });

  it("a non-destructive approval (e.g. from a plan) never covers a destructive call", () => {
    const d = evaluatePolicy(
      base({ kind: "destructive", config: { allowDestructive: true, allowedApps: ["*"], maxMonthlyCostToman: 1000 }, run: { approved: { fp1: "apr_1" }, approvals: [approval({ kind: "plan" })] } }),
    );
    expect(d.action).toBe("ask");
  });

  it("apps outside ALLOWED_APPS cannot be changed", () => {
    const d = evaluatePolicy(base({ resource: "prod-api", config: { allowDestructive: true, allowedApps: ["rahandaz-*"], maxMonthlyCostToman: 1000 } }));
    expect(d.action).toBe("block");
    expect(appAllowed({ allowedApps: ["rahandaz-*"] }, "rahandaz-shop")).toBe(true);
    expect(appAllowed({ allowedApps: ["rahandaz-*"] }, "prod.rahandaz-x")).toBe(false);
  });

  it("budget guard: over-budget actions require an explicit override on approval", () => {
    const d = evaluatePolicy(base({ monthlyCostToman: 5000 }));
    expect(d).toMatchObject({ action: "ask", requireBudgetOverride: true });
    const req = approval({ status: "pending", requireBudgetOverride: true });
    expect(validateResolution(req, { decision: "approved" })).toMatch(/بودجه/);
    expect(validateResolution(req, { decision: "approved", budgetOverride: true })).toBeNull();
  });

  it("typed confirmation must match exactly; secrets must be provided", () => {
    const req = approval({ status: "pending", kind: "destructive", requireTypedConfirmation: "shop", secretInputs: [{ key: "API_KEY", labelFa: "" }] });
    expect(validateResolution(req, { decision: "approved", confirmText: "Shop", secretValues: { API_KEY: "x" } })).not.toBeNull();
    expect(validateResolution(req, { decision: "approved", confirmText: "shop", secretValues: {} })).not.toBeNull();
    expect(validateResolution(req, { decision: "approved", confirmText: "shop", secretValues: { API_KEY: "x" } })).toBeNull();
    expect(validateResolution(req, { decision: "denied" })).toBeNull();
  });

  it("an approval can only be answered once", () => {
    expect(validateResolution(approval({ status: "approved" }), { decision: "approved" })).not.toBeNull();
  });

  it("fingerprints are stable under key order and differ for different args", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
    expect(fingerprint("deploy_app", { app: "x", port: 3000 })).toBe(fingerprint("deploy_app", { port: 3000, app: "x" }));
    expect(fingerprint("deploy_app", { app: "x", port: 3000 })).not.toBe(fingerprint("deploy_app", { app: "x", port: 8080 }));
    expect(fingerprint("deploy_app", { app: "x" })).not.toBe(fingerprint("restart_app", { app: "x" }));
  });
});
