import type { LiaraClient, PlannedCall } from "@rahandaz/liara";
import type { z } from "zod";
import type { AgentEventInput, ApprovalRequest, GateKind, RunState, ToolKind } from "../agent/types";
import type { AuditLog } from "../audit/audit-log";
import type { RahandazConfig } from "../config/config";
import type { DocsSearch } from "../knowledge/docs-search";
import type { Redactor } from "../safety/redactor";
import type { UntrustedSource } from "../safety/untrusted";
import type { SecretVault } from "../safety/vault";

export interface ToolContext {
  run: RunState;
  config: RahandazConfig;
  liara: LiaraClient;
  docs: DocsSearch;
  vault: SecretVault;
  redactor: Redactor;
  audit: AuditLog;
  emit(event: AgentEventInput): void;
}

export interface ToolResult {
  ok: boolean;
  /** One line for the timeline (Persian). */
  summaryFa: string;
  /** Structured result for the LLM. Must not contain secret values. */
  data?: unknown;
  /** Text from outside our trust boundary; wrapped in <untrusted> before the LLM sees it. */
  untrusted?: Array<{ source: UntrustedSource; label: string; text: string }>;
  error?: string;
}

/**
 * A typed tool. `kind` is the static safety tag; `classify` can raise it per
 * call (setting an env var is mutating, overwriting an existing one is
 * destructive). The executor, not the tool, enforces what the tag implies.
 */
export interface ToolDef<A = Record<string, unknown>> {
  name: string;
  /** English, for the LLM. */
  description: string;
  kind: GateKind;
  schema: z.ZodType<A>;
  titleFa(args: A): string;
  classify?(args: A, ctx: ToolContext): Promise<ToolKind>;
  /** The resource a change touches (for ALLOWED_APPS and typed confirmation). */
  resource?(args: A, ctx: ToolContext): string;
  /** Exact API calls (DRY_RUN output and approval card). */
  plannedCalls?(args: A, ctx: ToolContext): PlannedCall[];
  /** Monthly cost this action commits to, for the budget guard. */
  monthlyCost?(args: A, ctx: ToolContext): Promise<number | null>;
  /** Extra approval-card content: diffs, plan, secret inputs. */
  approvalExtras?(args: A, ctx: ToolContext): Promise<Partial<ApprovalRequest>>;
  /** How to undo this action once applied (Persian), for the run report and emergencies. */
  undoFa?(args: A): string;
  /** Override of the default tool timeout (tools that wait for builds/health). */
  timeoutMs?: number;
  /** Called after a gate approval (plan) to pre-approve its actions. */
  onApproved?(args: A, ctx: ToolContext, approval: ApprovalRequest): Promise<void>;
  execute(args: A, ctx: ToolContext): Promise<ToolResult>;
}

// The registry stores tools with erased argument types; each tool validates its own args.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = ToolDef<any>;

export function defineTool<A>(def: ToolDef<A>): ToolDef<A> {
  return def;
}
