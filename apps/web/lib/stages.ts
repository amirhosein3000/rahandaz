/**
 * Turns a run's raw events into the few stages a non-expert cares about, so
 * "where are we, and is it waiting for me?" is answered at a glance.
 */
import type { AgentEvent } from "@rahandaz/core";

export type StageState = "done" | "active" | "waiting" | "failed" | "pending";

export interface Stage {
  key: string;
  titleFa: string;
  state: StageState;
}

const DEPLOY: Array<{ key: string; titleFa: string; tools: string[]; optional?: boolean }> = [
  { key: "analyse", titleFa: "شناخت", tools: ["acquire_repo", "analyse_repo"] },
  { key: "plan", titleFa: "هزینه", tools: ["propose_deploy_plan"] },
  { key: "deploy", titleFa: "ساختن", tools: ["create_app", "set_env_vars", "deploy_app", "wait_for_release"] },
  { key: "fix", titleFa: "رفع مشکل", tools: ["get_app_logs", "diagnose_failure", "search_liara_docs", "apply_fix"], optional: true },
  { key: "verify", titleFa: "آماده", tools: ["check_health"] },
];

const SRE: Array<{ key: string; titleFa: string; tools: string[]; optional?: boolean }> = [
  { key: "evidence", titleFa: "بررسی", tools: ["list_apps", "get_app_status", "get_app_logs", "get_metrics"] },
  { key: "diagnose", titleFa: "علت", tools: ["sre_check", "diagnose_failure", "search_liara_docs"] },
  { key: "fix", titleFa: "رفع مشکل", tools: ["resize_app", "restart_app", "set_env_vars", "apply_fix", "deploy_app"], optional: true },
  { key: "verify", titleFa: "نتیجه", tools: ["sre_check:verify", "check_health"] },
];

export function runKind(events: AgentEvent[]): "deploy" | "sre" | "domain" | "simple" {
  const tools = new Set(events.flatMap((e) => (e.type === "tool_call" ? [e.tool] : [])));
  if (tools.has("acquire_repo") || tools.has("propose_deploy_plan")) return "deploy";
  if (tools.has("domain_status") || tools.has("add_domain")) return "domain";
  if (tools.has("generate_ci") || tools.has("explain_limitations")) return "simple";
  return "sre";
}

/** Domain stages come straight from the latest checklist: it already knows who does what. */
function domainStages(events: AgentEvent[], status: string): Stage[] {
  const last = [...events].reverse().find((e) => e.type === "domain_status");
  const titles: Record<string, string> = { attach: "اتصال به سایت", records: "تنظیم آدرس", nameservers: "قدم شما در ایرنیک", verified: "تأیید لیارا", ssl: "قفل امنیتی (https)" };
  if (!last || last.type !== "domain_status") return Object.entries(titles).map(([key, titleFa]) => ({ key, titleFa, state: "pending" as StageState }));
  let activeSet = false;
  return last.status.steps.map((st) => {
    let state: StageState = st.done ? "done" : "pending";
    if (!st.done && !activeSet) {
      activeSet = true;
      state = status === "awaiting_approval" || (st.who === "user" && status === "completed") ? "waiting" : status === "running" ? "active" : "pending";
    }
    return { key: st.key, titleFa: titles[st.key] ?? st.titleFa, state };
  });
}

export function stagesFor(events: AgentEvent[], status: string): Stage[] {
  const kind = runKind(events);
  if (kind === "simple") return [];
  if (kind === "domain") return domainStages(events, status);
  const defs = kind === "deploy" ? DEPLOY : SRE;
  const seen = new Map<string, "ok" | "fail" | "running" | "waiting">();
  let lastStage = -1;
  const results = new Map<string, boolean>();
  for (const e of events) if (e.type === "tool_result") results.set(e.callId, e.ok);

  for (const e of events) {
    if (e.type !== "tool_call") continue;
    const tool = e.tool === "sre_check" && (e.args as { afterChange?: boolean })?.afterChange ? "sre_check:verify" : e.tool;
    const idx = defs.findIndex((d) => d.tools.includes(tool));
    if (idx < 0) continue;
    // After a fix, a check belongs to "verify", not "diagnose".
    const stage = kind === "sre" && tool === "check_health" ? defs.length - 1 : idx;
    lastStage = Math.max(lastStage, stage);
    const ok = results.get(e.callId);
    seen.set(defs[stage]!.key, ok === undefined ? "running" : ok ? "ok" : "fail");
  }
  const pendingApproval = events.some((e) => e.type === "approval_required") && status === "awaiting_approval";
  const finished = status === "completed" || status === "failed" || status === "stopped";
  const healthy = events.some((e) => e.type === "summary" && e.card.outcome === "healthy");

  const out: Stage[] = [];
  defs.forEach((d, i) => {
    if (d.optional && !seen.has(d.key)) return;
    let state: StageState = "pending";
    if (i < lastStage) state = "done";
    else if (i === lastStage) {
      const s = seen.get(d.key);
      state = pendingApproval ? "waiting" : finished ? (s === "fail" || (!healthy && status === "failed") ? "failed" : "done") : "active";
    }
    out.push({ key: d.key, titleFa: d.titleFa, state });
  });
  if (finished && healthy) for (const s of out) if (s.state === "pending") s.state = "done";
  return out;
}

/** What the agent is doing right now, in one line. */
export function currentActivity(events: AgentEvent[], status: string): string | null {
  if (status === "awaiting_approval") return "منتظر تأیید شما";
  if (status !== "running") return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "tool_call") return e.titleFa;
    if (e.type === "tool_result") return "در حال فکرکردن به قدم بعدی";
  }
  return "در حال شروع";
}
