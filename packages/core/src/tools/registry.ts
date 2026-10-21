import { z } from "zod";
import type { ToolSchema } from "../llm/types";
import {
  checkHealthTool,
  createAppTool,
  deleteAppTool,
  deployAppTool,
  getAppLogsTool,
  getAppStatusTool,
  getMetricsTool,
  listAppsTool,
  resizeAppTool,
  restartAppTool,
  setEnvVarsTool,
  stopAppTool,
  waitForReleaseTool,
} from "./liara-tools";
import { diagnoseFailureTool, explainLimitationsTool, searchDocsTool } from "./knowledge-tools";
import { sreCheckTool } from "./sre-tools";
import { addDomainTool, domainStatusTool, enableSslTool, setupDnsTool } from "./domain-tools";
import { acquireRepoTool, analyseRepoTool, applyFixTool, proposeDeployPlanTool } from "./repo-tools";
import type { AnyTool } from "./types";

/** Every tool the agent can call. Adding a tool = define it, add it here, add a policy test. */
export const ALL_TOOLS: AnyTool[] = [
  acquireRepoTool,
  analyseRepoTool,
  proposeDeployPlanTool,
  applyFixTool,
  searchDocsTool,
  diagnoseFailureTool,
  sreCheckTool,
  explainLimitationsTool,
  domainStatusTool,
  addDomainTool,
  setupDnsTool,
  enableSslTool,
  listAppsTool,
  getAppStatusTool,
  getAppLogsTool,
  getMetricsTool,
  checkHealthTool,
  waitForReleaseTool,
  createAppTool,
  setEnvVarsTool,
  deployAppTool,
  restartAppTool,
  resizeAppTool,
  stopAppTool,
  deleteAppTool,
];

export class ToolRegistry {
  private readonly byName = new Map<string, AnyTool>();

  constructor(tools: AnyTool[] = ALL_TOOLS) {
    for (const t of tools) {
      if (this.byName.has(t.name)) throw new Error(`duplicate tool ${t.name}`);
      this.byName.set(t.name, t);
    }
  }

  get(name: string): AnyTool | undefined {
    return this.byName.get(name);
  }

  list(): AnyTool[] {
    return [...this.byName.values()];
  }

  /** JSON schemas for the LLM. Destructive tools are listed only when they could be allowed at all. */
  schemas(opts: { allowDestructive: boolean }): ToolSchema[] {
    return this.list()
      .filter((t) => opts.allowDestructive || t.kind !== "destructive")
      .map((t) => {
        const { $schema: _ignored, ...parameters } = z.toJSONSchema(t.schema) as Record<string, unknown>;
        const tag = t.kind === "read" ? "[read-only]" : t.kind === "plan" ? "[needs user approval]" : t.kind === "mutating" ? "[changes resources: needs user approval]" : "[DESTRUCTIVE: needs ALLOW_DESTRUCTIVE and typed confirmation]";
        return { type: "function" as const, function: { name: t.name, description: `${tag} ${t.description}`, parameters } };
      });
  }
}
