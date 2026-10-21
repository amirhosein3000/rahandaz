import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type RahandazConfig } from "../src/config/config";
import { createRahandaz, type Rahandaz } from "../src/factory";
import type { RunState } from "../src/agent/types";
import type { LlmProvider } from "../src/llm/types";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function testConfig(env: Record<string, string> = {}): RahandazConfig {
  return loadConfig({
    RAHANDAZ_ROOT: ROOT,
    RAHANDAZ_DATA_DIR: path.join(os.tmpdir(), `rahandaz-test-${crypto.randomBytes(4).toString("hex")}`),
    MOCK_LATENCY_SCALE: "0",
    MOCK_LLM: "true",
    LIARA_MODE: "mock",
    ...env,
  });
}

export function makeApp(env: Record<string, string> = {}, llm?: LlmProvider): Rahandaz {
  return createRahandaz({ config: testConfig(env), ...(llm ? { llm } : {}) });
}

/** Approve every request like a cooperative user would, typing names and secrets when asked. */
export async function runToEnd(
  app: Rahandaz,
  message: string,
  opts: { approve?: (approvalTool: string) => boolean; secret?: string; budgetOverride?: boolean; maxApprovals?: number } = {},
): Promise<RunState> {
  const run = app.runtime.startRun({ message });
  let approvals = 0;
  for (;;) {
    const state = await app.runtime.settled(run.id, 30_000);
    if (state.status !== "awaiting_approval") return state;
    if (++approvals > (opts.maxApprovals ?? 20)) throw new Error("too many approvals");
    const approval = state.approvals.find((a) => a.id === state.pendingApprovalId)!;
    const yes = opts.approve ? opts.approve(approval.tool) : true;
    const res = await app.runtime.resolveApproval(run.id, approval.id, {
      decision: yes ? "approved" : "denied",
      actor: "user:test",
      confirmText: approval.requireTypedConfirmation,
      budgetOverride: opts.budgetOverride,
      secretValues: Object.fromEntries(approval.secretInputs.map((s) => [s.key, opts.secret ?? "https://api.example.test"])),
    });
    if (!res.ok) throw new Error(`approval rejected: ${res.errorFa}`);
  }
}

export function toolsCalled(app: Rahandaz, runId: string): string[] {
  return app.runtime.events(runId).flatMap((e) => (e.type === "tool_call" ? [e.tool] : []));
}
