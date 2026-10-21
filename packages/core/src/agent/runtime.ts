/**
 * Agent runtime: the tool-calling loop, the policy-enforcing executor,
 * approvals and the event stream. One instance per process; the web console,
 * CLI and chat bot all drive runs through it.
 *
 * Loop: LLM → tool calls → (policy) → execute | ask user | block → tool
 * results → LLM … until the LLM answers without tool calls, a limit is hit, or
 * the run waits for an approval. Approvals resume the loop via resolveApproval().
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LiaraApiError, type LiaraClient } from "@rahandaz/liara";
import type { AuditActor, AuditLog } from "../audit/audit-log";
import type { RahandazConfig } from "../config/config";
import type { DocsSearch } from "../knowledge/docs-search";
import type { ChatMessage, LlmProvider, ToolCall } from "../llm/types";
import { fingerprint } from "../policy/fingerprint";
import { evaluatePolicy, validateResolution, type ResolutionInput } from "../policy/policy";
import type { Redactor } from "../safety/redactor";
import { scanForInjection, wrapUntrusted } from "../safety/untrusted";
import { SecretVault } from "../safety/vault";
import { ToolRegistry } from "../tools/registry";
import type { AnyTool, ToolContext, ToolResult } from "../tools/types";
import { systemPrompt } from "./prompt";
import { buildSummary } from "./summary";
import type { AgentEvent, AgentEventInput, ApprovalRequest, GateKind, RunState, RunStatus, RunTrigger } from "./types";
export type { AppliedAction } from "./types";

export interface RuntimeDeps {
  config: RahandazConfig;
  liara: LiaraClient;
  llm: LlmProvider;
  docs: DocsSearch;
  audit: AuditLog;
  redactor: Redactor;
  registry?: ToolRegistry;
}

interface RunRecord {
  state: RunState;
  events: AgentEvent[];
  listeners: Set<(e: AgentEvent) => void>;
  vault: SecretVault;
  driving: boolean;
  failedCalls: Map<string, number>;
  startedAtMs: number;
}

type Listener = (e: AgentEvent) => void;

const MAX_MALFORMED = 3;
const MAX_SAME_FAILURE = 3;

export class AgentRuntime {
  readonly registry: ToolRegistry;
  private readonly runs = new Map<string, RunRecord>();
  private readonly globalListeners = new Set<Listener>();
  private readonly runsDir: string;

  constructor(private readonly deps: RuntimeDeps) {
    this.registry = deps.registry ?? new ToolRegistry();
    this.runsDir = path.join(deps.config.dataDir, "runs");
    fs.mkdirSync(this.runsDir, { recursive: true });
  }

  get config() {
    return this.deps.config;
  }
  get liara() {
    return this.deps.liara;
  }
  get audit() {
    return this.deps.audit;
  }

  // ── public API ───────────────────────────────────────────────

  startRun(input: { message: string; trigger?: RunTrigger; actor?: string }): RunState {
    const id = `run_${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`;
    const actor = input.actor ?? "user:web";
    const state: RunState = {
      id,
      title: input.message.slice(0, 80),
      trigger: input.trigger ?? "user",
      actor,
      status: "running",
      createdAt: new Date().toISOString(),
      finishedAt: null,
      messages: [
        { role: "system", content: systemPrompt(this.deps.config) },
        { role: "user", content: input.message },
      ],
      queue: [],
      steps: 0,
      malformedCalls: 0,
      usage: { promptTokens: 0, completionTokens: 0 },
      workspace: null,
      analysis: null,
      plan: null,
      appName: null,
      releases: [],
      diagnoses: [],
      fixes: {},
      appliedFixes: [],
      healAttempts: 0,
      docsCited: [],
      approvals: [],
      pendingApprovalId: null,
      approved: {},
      tainted: false,
      lastHealthOk: null,
      applied: [],
      summary: null,
    };
    const rec: RunRecord = {
      state,
      events: [],
      listeners: new Set(),
      vault: new SecretVault(this.deps.redactor),
      driving: false,
      failedCalls: new Map(),
      startedAtMs: Date.now(),
    };
    this.runs.set(id, rec);
    this.deps.audit.append({ actor: actor as AuditActor, action: "run_started", runId: id, result: "info", detail: state.trigger });
    this.emit(rec, { type: "run_started", trigger: state.trigger, messageFa: input.message, actor });
    void this.drive(rec);
    return state;
  }

  sendMessage(runId: string, text: string, actor = "user:web"): { ok: boolean; errorFa?: string } {
    const rec = this.runs.get(runId);
    if (!rec) return { ok: false, errorFa: "اجرا پیدا نشد" };
    if (rec.state.status === "awaiting_approval") return { ok: false, errorFa: "اول به درخواست تأیید باز پاسخ دهید." };
    if (rec.state.status === "running") return { ok: false, errorFa: "ایجنت در حال کار است؛ چند لحظه صبر کنید." };
    rec.state.messages.push({ role: "user", content: text });
    this.emit(rec, { type: "user", text, actor });
    this.setStatus(rec, "running");
    rec.state.summary = null;
    void this.drive(rec);
    return { ok: true };
  }

  async resolveApproval(
    runId: string,
    approvalId: string,
    input: ResolutionInput & { actor: string },
  ): Promise<{ ok: boolean; errorFa?: string }> {
    const rec = this.runs.get(runId);
    if (!rec) return { ok: false, errorFa: "اجرا پیدا نشد" };
    const run = rec.state;
    const approval = run.approvals.find((a) => a.id === approvalId);
    if (!approval || run.pendingApprovalId !== approvalId) return { ok: false, errorFa: "این درخواست تأیید فعال نیست." };
    const error = validateResolution(approval, input);
    if (error) return { ok: false, errorFa: error };

    const call = run.queue[0];
    if (!call || call.id !== approval.toolCallId) return { ok: false, errorFa: "وضعیت اجرا با درخواست تأیید هم‌خوان نیست." };
    const actor = input.actor as AuditActor;
    run.pendingApprovalId = null;

    if (input.decision === "denied") {
      approval.status = "denied";
      this.deps.audit.append({ actor, action: "approval", runId, tool: approval.tool, kind: approval.kind, resource: approval.resource, result: "denied" });
      this.emit(rec, { type: "approval_resolved", approvalId, decision: "denied", actor: input.actor });
      this.pushToolMessage(rec, call, { ok: false, summaryFa: "کاربر این اقدام را رد کرد", data: { denied: true, note: "The user denied this action. Do not retry it." } });
      run.queue.shift();
      this.setStatus(rec, "running");
      void this.drive(rec);
      return { ok: true };
    }

    // Approved: secret values go straight into the vault (and the redactor), never into messages.
    for (const s of approval.secretInputs) rec.vault.putUserValue(s.key, input.secretValues![s.key]!.trim());
    approval.status = "approved";
    const tool = this.registry.get(approval.tool)!;
    const args = JSON.parse(call.function.arguments || "{}");
    run.approved[fingerprint(tool.name, args)] = approval.id;
    await tool.onApproved?.(args, this.ctx(rec), approval);
    this.deps.audit.append({
      actor,
      action: "approval",
      runId,
      tool: approval.tool,
      kind: approval.kind,
      resource: approval.resource,
      args: approval.args,
      result: "approved",
      detail: [approval.requireTypedConfirmation ? "typed confirmation" : "", input.budgetOverride ? "budget override" : "", approval.secretInputs.length ? `${approval.secretInputs.length} secret(s) entered` : ""].filter(Boolean).join(", ") || undefined,
    });
    this.emit(rec, { type: "approval_resolved", approvalId, decision: "approved", actor: input.actor });
    this.setStatus(rec, "running");
    void this.drive(rec);
    return { ok: true };
  }

  stopRun(runId: string, actor = "user:web"): boolean {
    const rec = this.runs.get(runId);
    if (!rec || rec.state.status === "completed" || rec.state.status === "failed" || rec.state.status === "stopped") return false;
    this.deps.audit.append({ actor: actor as AuditActor, action: "run_stopped", runId, result: "info" });
    this.finish(rec, "stopped", "اجرا به درخواست شما متوقف شد.");
    return true;
  }

  getRun(runId: string): RunState | undefined {
    return this.runs.get(runId)?.state;
  }

  listRuns(): RunState[] {
    return [...this.runs.values()].map((r) => r.state).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  events(runId: string, afterSeq = 0): AgentEvent[] {
    return (this.runs.get(runId)?.events ?? []).filter((e) => e.seq > afterSeq);
  }

  subscribe(runId: string, fn: Listener): () => void {
    const rec = this.runs.get(runId);
    if (!rec) return () => {};
    rec.listeners.add(fn);
    return () => rec.listeners.delete(fn);
  }

  subscribeAll(fn: Listener): () => void {
    this.globalListeners.add(fn);
    return () => this.globalListeners.delete(fn);
  }

  /** Resolves when the run stops making progress on its own (finished or waiting for the user). */
  async settled(runId: string, timeoutMs = 60_000): Promise<RunState> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const rec = this.runs.get(runId);
      if (!rec) throw new Error(`no run ${runId}`);
      if (!rec.driving && rec.state.status !== "running") return rec.state;
      if (Date.now() > deadline) throw new Error(`run ${runId} did not settle (status ${rec.state.status})`);
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  // ── loop ────────────────────────────────────────────────────

  private async drive(rec: RunRecord): Promise<void> {
    if (rec.driving) return;
    rec.driving = true;
    const run = rec.state;
    try {
      while (run.status === "running") {
        if (run.queue.length) {
          const outcome = await this.handleCall(rec, run.queue[0]!);
          if (outcome === "paused") return;
          if (outcome === "stop") return;
          run.queue.shift();
          continue;
        }
        if (run.steps >= this.deps.config.maxSteps) {
          this.finish(rec, "failed", this.withApplied(run, `به سقف ${this.deps.config.maxSteps} گام رسیدم و متوقف شدم تا در حلقه نمانم.`));
          return;
        }
        const tokens = run.usage.promptTokens + run.usage.completionTokens;
        if (tokens >= this.deps.config.maxRunTokens) {
          this.finish(rec, "failed", this.withApplied(run, `بودجه‌ی توکن این اجرا (${this.deps.config.maxRunTokens}) تمام شد و متوقف شدم.`));
          return;
        }
        run.steps += 1;
        let result;
        try {
          result = await this.deps.llm.complete({
            messages: run.messages.map((m) => (m.content ? { ...m, content: this.deps.redactor.redact(m.content) } : m)),
            tools: this.registry.schemas({ allowDestructive: this.deps.config.allowDestructive }),
          });
        } catch (err) {
          this.finish(rec, "failed", this.withApplied(run, `ارتباط با مدل زبانی برقرار نشد (${(err as Error).message}). هیچ فراخوانی در حال اجرا نیست؛ می‌توانید دوباره امتحان کنید.`));
          return;
        }
        if (result.usage) {
          run.usage.promptTokens += result.usage.promptTokens;
          run.usage.completionTokens += result.usage.completionTokens;
        }
        const msg: ChatMessage = { role: "assistant", content: result.message.content ?? null, tool_calls: result.message.tool_calls };
        run.messages.push(msg);
        if (msg.content?.trim() && msg.tool_calls?.length) this.emit(rec, { type: "assistant", text: this.deps.redactor.redact(msg.content.trim()) });
        if (msg.tool_calls?.length) {
          run.queue = [...msg.tool_calls];
          continue;
        }
        this.finish(rec, "completed", msg.content?.trim() || "تمام شد.");
        return;
      }
    } catch (err) {
      this.finish(rec, "failed", this.withApplied(run, `خطای داخلی: ${this.deps.redactor.redact((err as Error).message)}`));
    } finally {
      rec.driving = false;
    }
  }

  /** Policy gate + execution for one tool call. */
  private async handleCall(rec: RunRecord, call: ToolCall): Promise<"done" | "paused" | "stop"> {
    const run = rec.state;
    const tool = this.registry.get(call.function.name);
    if (!tool) return this.malformed(rec, call, `unknown tool "${call.function.name}"`);

    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(call.function.arguments || "{}");
    } catch {
      return this.malformed(rec, call, "arguments are not valid JSON");
    }
    const parsed = tool.schema.safeParse(rawArgs);
    if (!parsed.success) {
      return this.malformed(rec, call, `invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
    }
    const args = parsed.data as Record<string, unknown>;
    const ctx = this.ctx(rec);

    let kind: GateKind = tool.kind;
    try {
      if (tool.classify) kind = await tool.classify(args, ctx);
    } catch {
      // If we cannot tell whether it overwrites, assume the worst.
      if (tool.kind === "mutating") kind = "destructive";
    }
    const resource = tool.resource ? tool.resource(args, ctx) : null;
    const fp = fingerprint(tool.name, args);
    const monthlyCost = tool.monthlyCost ? await tool.monthlyCost(args, ctx).catch(() => null) : null;

    const decision = evaluatePolicy({
      tool: tool.name,
      kind,
      resource,
      fingerprint: fp,
      monthlyCostToman: monthlyCost,
      run,
      config: this.deps.config,
    });

    if (decision.action === "block") {
      this.emit(rec, { type: "policy_blocked", tool: tool.name, reasonFa: decision.reasonFa });
      this.deps.audit.append({ actor: "agent", action: "tool_call", runId: run.id, tool: tool.name, kind, resource: resource ?? undefined, args, result: "blocked", detail: decision.reason });
      this.pushToolMessage(rec, call, { ok: false, summaryFa: decision.reasonFa, data: { blocked: true, reason: decision.reason } });
      return "done";
    }

    if (decision.action === "ask") {
      let extras: Partial<ApprovalRequest> = {};
      try {
        extras = tool.approvalExtras ? await tool.approvalExtras(args, ctx) : {};
      } catch (err) {
        this.pushToolMessage(rec, call, { ok: false, summaryFa: "آماده‌سازی درخواست تأیید ناموفق بود", error: (err as Error).message });
        return "done";
      }
      const approvalResource = extras.resource ?? resource ?? tool.name;
      const approval: ApprovalRequest = {
        id: `apr_${crypto.randomBytes(4).toString("hex")}`,
        runId: run.id,
        toolCallId: call.id,
        tool: tool.name,
        titleFa: extras.titleFa ?? tool.titleFa(args),
        kind: decision.kind,
        resource: approvalResource,
        args: this.deps.redactor.redactDeep(args),
        calls: extras.calls ?? tool.plannedCalls?.(args, ctx) ?? [],
        diffs: extras.diffs,
        plan: extras.plan,
        secretInputs: extras.secretInputs ?? [],
        requireTypedConfirmation: decision.kind === "destructive" ? approvalResource : undefined,
        requireBudgetOverride: decision.requireBudgetOverride || Boolean(extras.requireBudgetOverride),
        monthlyCostToman: extras.monthlyCostToman ?? monthlyCost ?? undefined,
        dryRun: this.deps.config.dryRun,
        taintedWarningFa: run.tainted
          ? "این اجرا محتوایی خوانده که شبیه دستور به هوش مصنوعی بود (در مخزن یا لاگ). ما آن را دستور حساب نکردیم؛ این درخواست را با دقت بررسی کنید."
          : undefined,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      run.approvals.push(approval);
      run.pendingApprovalId = approval.id;
      this.deps.audit.append({ actor: "agent", action: "approval_requested", runId: run.id, tool: tool.name, kind: decision.kind, resource: approvalResource, args, result: "requested" });
      this.emit(rec, { type: "tool_call", callId: call.id, tool: tool.name, titleFa: approval.titleFa, kind: decision.kind, args: approval.args });
      this.emit(rec, { type: "approval_required", approval });
      this.setStatus(rec, "awaiting_approval");
      return "paused";
    }

    // execute
    const failures = rec.failedCalls.get(fp) ?? 0;
    if (failures >= MAX_SAME_FAILURE) {
      this.finish(rec, "failed", this.withApplied(run, `فراخوانی ${tool.name} با همین ورودی ${failures} بار شکست خورد؛ برای جلوگیری از حلقه متوقف شدم.`));
      return "stop";
    }
    if (decision.viaApproval) delete run.approved[fp]; // single use
    this.emit(rec, { type: "tool_call", callId: call.id, tool: tool.name, titleFa: tool.titleFa(args), kind: decision.kind, args: this.deps.redactor.redactDeep(args) });
    const result = await this.execute(rec, tool, args, decision.kind, resource, decision.viaApproval);
    if (!result.ok) rec.failedCalls.set(fp, failures + 1);
    this.pushToolMessage(rec, call, result);
    return "done";
  }

  private async execute(rec: RunRecord, tool: AnyTool, args: Record<string, unknown>, kind: GateKind, resource: string | null, viaApproval: string | null): Promise<ToolResult & { dryRun?: boolean }> {
    const run = rec.state;
    const ctx = this.ctx(rec);
    const changesState = kind === "mutating" || kind === "destructive";

    if (changesState && this.deps.config.dryRun) {
      const calls = tool.plannedCalls?.(args, ctx) ?? [];
      this.deps.audit.append({ actor: "agent", action: "tool_call", runId: run.id, tool: tool.name, kind, resource: resource ?? undefined, args, result: "dry_run" });
      const result = { ok: true, dryRun: true, summaryFa: `DRY_RUN: اجرا نشد؛ ${calls.length} فراخوانی API نمایش داده شد`, data: { dryRun: true, calls } };
      this.emit(rec, { type: "tool_result", callId: run.queue[0]!.id, tool: tool.name, ok: true, summaryFa: result.summaryFa, dryRun: true, calls });
      return result;
    }

    let result: ToolResult;
    const timeoutMs = tool.timeoutMs ?? this.deps.config.toolTimeoutMs;
    let timer: NodeJS.Timeout | undefined;
    try {
      result = await Promise.race([
        tool.execute(args, ctx),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
        }),
      ]);
    } catch (err) {
      const e = err as Error;
      const retryable = err instanceof LiaraApiError ? err.retryable : false;
      result = {
        ok: false,
        summaryFa: err instanceof LiaraApiError ? `خطای API لیارا (${err.status || "شبکه"})` : `خطا: ${e.message}`,
        error: `${e.message}${retryable ? " (retryable: you may try once more later)" : ""}`,
      };
    } finally {
      clearTimeout(timer);
    }
    if (result.ok && changesState) {
      run.applied.push({ tool: tool.name, titleFa: tool.titleFa(args), resource, ts: new Date().toISOString(), undoFa: tool.undoFa?.(args) ?? "" });
    }
    if (changesState || kind === "plan") {
      this.deps.audit.append({
        actor: "agent",
        action: "tool_call",
        runId: run.id,
        tool: tool.name,
        kind,
        resource: resource ?? undefined,
        args,
        result: result.ok ? "ok" : "error",
        detail: [viaApproval ? `approval ${viaApproval}` : "", result.ok ? "" : result.error ?? ""].filter(Boolean).join("; ") || undefined,
      });
    }
    for (const u of result.untrusted ?? []) {
      if (u.source === "repo_file") continue; // analyse_repo already reported these per file
      const findings = scanForInjection(u.text);
      if (findings.length) {
        run.tainted = true;
        this.emit(rec, { type: "injection_warning", source: u.label, findings });
        this.deps.audit.append({ actor: "system", action: "injection_detected", runId: run.id, tool: tool.name, result: "info", detail: `${u.label}: ${findings.map((f) => f.rule).join(",")}` });
      }
    }
    this.emit(rec, { type: "tool_result", callId: run.queue[0]!.id, tool: tool.name, ok: result.ok, summaryFa: result.summaryFa });
    return result;
  }

  /** Append what was really changed (and how to undo it) to a stop message: no silent partial state. */
  private withApplied(run: RunState, textFa: string): string {
    if (!run.applied.length) return `${textFa}\nهیچ تغییری روی منابع اعمال نشده است.`;
    return [textFa, "تغییرهایی که تا این لحظه اعمال شده‌اند:", ...run.applied.map((a) => `• ${a.titleFa}${a.undoFa ? ` (برای برگرداندن: ${a.undoFa})` : ""}`)].join("\n");
  }

  private malformed(rec: RunRecord, call: ToolCall, reason: string): "done" | "stop" {
    rec.state.malformedCalls += 1;
    this.pushToolMessage(rec, call, { ok: false, summaryFa: "فراخوانی نامعتبر", error: `${reason}. Check the tool schema and try again.` });
    if (rec.state.malformedCalls > MAX_MALFORMED) {
      this.finish(rec, "failed", this.withApplied(rec.state, "مدل زبانی چند بار پشت سر هم فراخوانی نامعتبر داد؛ برای ایمنی متوقف شدم."));
      return "stop";
    }
    return "done";
  }

  private pushToolMessage(rec: RunRecord, call: ToolCall, result: ToolResult & { dryRun?: boolean }): void {
    const body = {
      ok: result.ok,
      summary: result.summaryFa,
      ...(result.data !== undefined ? { data: result.data } : {}),
      ...(result.error ? { error: result.error } : {}),
    };
    const untrusted = (result.untrusted ?? []).filter((u) => u.text.trim()).map((u) => wrapUntrusted(u.source, `[${u.label}]\n${u.text}`));
    const content = this.deps.redactor.redact([JSON.stringify(this.deps.redactor.redactDeep(body)), ...untrusted].join("\n"));
    rec.state.messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content });
  }

  private ctx(rec: RunRecord): ToolContext {
    return {
      run: rec.state,
      config: this.deps.config,
      liara: this.deps.liara,
      docs: this.deps.docs,
      vault: rec.vault,
      redactor: this.deps.redactor,
      audit: this.deps.audit,
      emit: (e) => this.emit(rec, e),
    };
  }

  private setStatus(rec: RunRecord, status: RunStatus, reasonFa?: string) {
    if (rec.state.status === status && !reasonFa) return;
    rec.state.status = status;
    this.emit(rec, { type: "status", status, reasonFa });
  }

  private finish(rec: RunRecord, status: Exclude<RunStatus, "running" | "awaiting_approval">, textFa: string) {
    const run = rec.state;
    if (run.status === "completed" || run.status === "failed" || run.status === "stopped") return;
    run.queue = [];
    run.pendingApprovalId = null;
    // Unused pre-approvals die with the run; a follow-up message starts from zero.
    run.approved = {};
    for (const a of run.approvals) if (a.status === "pending") a.status = "denied";
    run.finishedAt = new Date().toISOString();
    const text = this.deps.redactor.redact(textFa);
    this.emit(rec, { type: "assistant", text });
    run.summary = buildSummary(run, rec.events, { status, textFa: text, durationMs: Date.now() - rec.startedAtMs, dryRun: this.deps.config.dryRun });
    this.emit(rec, { type: "summary", card: run.summary });
    this.setStatus(rec, status);
    this.deps.audit.append({ actor: "system", action: "run_finished", runId: run.id, result: status === "completed" ? "ok" : status === "stopped" ? "info" : "error", detail: run.summary.outcome });
    try {
      const { messages: _m, ...snapshot } = run;
      fs.writeFileSync(path.join(this.runsDir, `${run.id}.json`), JSON.stringify(this.deps.redactor.redactDeep(snapshot), null, 2));
    } catch {
      // Persistence is best-effort; the audit log is the record of truth.
    }
  }

  private emit(rec: RunRecord, body: AgentEventInput) {
    const event = this.deps.redactor.redactDeep({ ...body, seq: rec.events.length + 1, ts: new Date().toISOString(), runId: rec.state.id }) as AgentEvent;
    rec.events.push(event);
    try {
      fs.appendFileSync(path.join(this.runsDir, `${rec.state.id}.events.jsonl`), JSON.stringify(event) + "\n");
    } catch {
      // best-effort
    }
    for (const fn of rec.listeners) fn(event);
    for (const fn of this.globalListeners) fn(event);
  }
}
