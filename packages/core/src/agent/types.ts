import type { HealthResult, PlannedCall, ReleaseState } from "@rahandaz/liara";
import type { RepoAnalysis } from "../analyser/types";
import type { Diagnosis, FixProposal } from "../healer/diagnose";
import type { DocHit } from "../knowledge/docs-search";
import type { ChatMessage, ToolCall } from "../llm/types";
import type { DeployPlan } from "../planner/plan";
import type { Workspace } from "../repo/workspace";
import type { InjectionFinding } from "../safety/untrusted";
import type { SreReport } from "../sre/report";

export type ToolKind = "read" | "mutating" | "destructive";
/** "plan" = an approval gate that changes nothing by itself (propose_deploy_plan). */
export type GateKind = ToolKind | "plan";

export type RunStatus = "running" | "awaiting_approval" | "completed" | "failed" | "stopped";
export type RunTrigger = "user" | "incident" | "chat";

export interface ApprovalRequest {
  id: string;
  runId: string;
  toolCallId: string;
  tool: string;
  titleFa: string;
  kind: Exclude<GateKind, "read">;
  /** The resource the action touches (app name). Destructive actions must be confirmed by typing it. */
  resource: string;
  args: unknown;
  /** Exact API calls that approval would allow. */
  calls: PlannedCall[];
  diffs?: Array<{ path: string; diff: string }>;
  plan?: DeployPlan;
  /** Env vars this action sets: names and where each value comes from (never the value). */
  envRefs?: Array<{ key: string; labelFa: string; overwrite: boolean }>;
  /** Env vars whose values the user must type into the card (never seen by the LLM). */
  secretInputs: Array<{ key: string; labelFa: string }>;
  requireTypedConfirmation?: string;
  requireBudgetOverride?: boolean;
  monthlyCostToman?: number;
  dryRun: boolean;
  /** Set when this run has read content containing instruction-like text. */
  taintedWarningFa?: string;
  status: "pending" | "approved" | "denied";
  createdAt: string;
}

export interface SummaryCard {
  outcome: "healthy" | "failed" | "dry_run" | "answered" | "stopped";
  appName: string | null;
  url: string | null;
  repo: string | null;
  stack: string | null;
  durationMs: number;
  steps: number;
  approvals: number;
  healAttempts: number;
  fixesFa: string[];
  rootCauseFa: string | null;
  monthlyCostToman: number | null;
  pricesVerified: boolean;
  docs: Array<{ title: string; url: string }>;
  ignoredInjection: boolean;
  /** Every change actually applied in this run, with its undo hint. */
  applied: Array<{ titleFa: string; undoFa: string }>;
  textFa: string;
}

type EventBody =
  | { type: "run_started"; trigger: RunTrigger; messageFa: string; actor: string }
  | { type: "user"; text: string; actor: string }
  | { type: "assistant"; text: string }
  | { type: "tool_call"; callId: string; tool: string; titleFa: string; kind: GateKind; args: unknown }
  | { type: "tool_result"; callId: string; tool: string; ok: boolean; summaryFa: string; dryRun?: boolean; calls?: PlannedCall[] }
  | { type: "log"; source: "build" | "app"; lines: string[] }
  | { type: "analysis"; analysis: RepoAnalysis; repo: string }
  | { type: "plan"; plan: DeployPlan }
  | { type: "approval_required"; approval: ApprovalRequest }
  | { type: "approval_resolved"; approvalId: string; decision: "approved" | "denied"; actor: string }
  | { type: "diagnosis"; diagnoses: Diagnosis[] }
  | { type: "docs"; query: string; hits: DocHit[] }
  | { type: "policy_blocked"; tool: string; reasonFa: string }
  | { type: "injection_warning"; source: string; findings: InjectionFinding[] }
  | { type: "health"; app: string; health: HealthResult }
  | { type: "sre_report"; report: SreReport }
  | { type: "release"; app: string; releaseId: string; state: ReleaseState; port?: number }
  | { type: "summary"; card: SummaryCard }
  | { type: "status"; status: RunStatus; reasonFa?: string }
  | { type: "error"; messageFa: string };

export type AgentEvent = EventBody & { seq: number; ts: string; runId: string };
export type AgentEventInput = EventBody;

/** A change that really happened (not dry-run), with how to undo it. */
export interface AppliedAction {
  tool: string;
  titleFa: string;
  resource: string | null;
  ts: string;
  undoFa: string;
}

export interface RunState {
  id: string;
  title: string;
  trigger: RunTrigger;
  actor: string;
  status: RunStatus;
  createdAt: string;
  finishedAt: string | null;
  messages: ChatMessage[];
  /** Tool calls from the latest assistant message not yet answered. */
  queue: ToolCall[];
  steps: number;
  malformedCalls: number;
  usage: { promptTokens: number; completionTokens: number };
  workspace: Workspace | null;
  analysis: RepoAnalysis | null;
  plan: DeployPlan | null;
  appName: string | null;
  releases: Array<{ id: string; app: string; state: ReleaseState; port?: number }>;
  diagnoses: Diagnosis[];
  fixes: Record<string, FixProposal>;
  appliedFixes: string[];
  healAttempts: number;
  docsCited: DocHit[];
  approvals: ApprovalRequest[];
  pendingApprovalId: string | null;
  /** Single-use approvals: fingerprint → approval id. */
  approved: Record<string, string>;
  tainted: boolean;
  lastHealthOk: boolean | null;
  applied: AppliedAction[];
  /** First SRE report per app in this run: the "before" for verifying a fix. */
  sreReports: Record<string, SreReport>;
  summary: SummaryCard | null;
}
