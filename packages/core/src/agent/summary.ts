import type { AgentEvent, RunState, RunStatus, SummaryCard } from "./types";

/** End-of-run card: what a developer would actually want to share. Built from run state, not from the LLM. */
export function buildSummary(
  run: RunState,
  events: AgentEvent[],
  opts: { status: RunStatus; textFa: string; durationMs: number; dryRun: boolean },
): SummaryCard {
  const lastDomain = [...events].reverse().find((e) => e.type === "domain_status");
  const dryRunHappened = events.some((e) => e.type === "tool_result" && e.dryRun);
  const touchedApp = Boolean(run.appName);
  let outcome: SummaryCard["outcome"];
  if (opts.status === "stopped") outcome = "stopped";
  else if (dryRunHappened) outcome = "dry_run";
  else if (run.lastHealthOk === true && touchedApp) outcome = "healthy";
  else if (lastDomain?.type === "domain_status" && lastDomain.status.next.who === "user") outcome = "waiting_user";
  else if (!touchedApp && opts.status === "completed") outcome = "answered";
  else outcome = "failed";

  const firstDiagnosis = events.find((e) => e.type === "diagnosis" && e.diagnoses.length > 0);
  const rootCauseFa = firstDiagnosis && firstDiagnosis.type === "diagnosis" ? firstDiagnosis.diagnoses[0]!.titleFa : null;

  const fixesFa = run.appliedFixes.map((id) => run.fixes[id]?.titleFa).filter((t): t is string => Boolean(t));
  for (const e of events) {
    if (e.type === "tool_result" && e.ok && e.tool === "set_env_vars" && firstDiagnosis && e.seq > firstDiagnosis.seq) fixesFa.push(e.summaryFa);
  }

  return {
    outcome,
    appName: run.appName,
    url: run.plan?.url ?? (run.appName ? `https://${run.appName}.liara.run` : null),
    repo: run.workspace?.origin ?? null,
    stack: run.analysis?.stackLabel ?? null,
    durationMs: opts.durationMs,
    steps: run.steps,
    approvals: run.approvals.filter((a) => a.status === "approved").length,
    healAttempts: run.appliedFixes.length,
    fixesFa,
    rootCauseFa,
    monthlyCostToman: run.plan?.monthlyCostToman ?? null,
    pricesVerified: run.plan?.pricesVerified ?? false,
    docs: run.docsCited.slice(0, 4).map((d) => ({ title: d.title, url: d.url })),
    ignoredInjection: run.tainted,
    applied: run.applied.map((a) => ({ titleFa: a.titleFa, undoFa: a.undoFa })),
    textFa: opts.textFa,
  };
}
