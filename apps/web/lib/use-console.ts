"use client";
/**
 * Console state: one EventSource for all runs, reduced per run. New runs
 * started while the page is open (including incident runs started by the
 * health monitor) become the selected run automatically.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent, ApprovalRequest, RunStatus } from "@rahandaz/core";

export interface ConsoleState {
  modes: {
    liara: "mock" | "real";
    llm: string;
    dryRun: boolean;
    allowDestructive: boolean;
    maxMonthlyCostToman: number;
    allowedApps: string[];
    docs: { chunks: number; dense: boolean };
  };
  apps: Array<{ name: string; status: string; platform: string; health: { ok: boolean; status?: number; url: string; error?: string } | null }>;
  fixtures: Array<{ name: string; titleFa: string; hero?: boolean; failure: string | null }>;
  chaos: Array<{ id: "missing_env" | "wrong_port"; titleFa: string; descriptionFa: string }>;
}

export interface RunView {
  id: string;
  title: string;
  trigger: string;
  status: RunStatus;
  startedAt: string;
  events: AgentEvent[];
  pendingApproval: ApprovalRequest | null;
}

export function useConsole() {
  const [state, setState] = useState<ConsoleState | null>(null);
  const [runs, setRuns] = useState<Record<string, RunView>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const userPicked = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (res.ok) setState(await res.json());
    } catch {
      // offline: keep last state
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      const e = JSON.parse(msg.data) as AgentEvent & { backlog?: boolean };
      if ((e as { type: string }).type === "ready") return;
      setRuns((prev) => reduce(prev, e));
      if (e.type === "run_started" && (!e.backlog || !userPicked.current)) {
        setSelected(e.runId);
        if (!e.backlog) userPicked.current = false;
      }
      if (e.type === "health" || e.type === "summary") void refresh();
    };
    return () => es.close();
  }, [refresh]);

  const select = useCallback((id: string) => {
    userPicked.current = true;
    setSelected(id);
  }, []);

  const runList = useMemo(() => Object.values(runs).sort((a, b) => b.startedAt.localeCompare(a.startedAt)), [runs]);
  return { state, runs: runList, current: selected ? runs[selected] ?? null : null, select, connected, refresh };
}

function reduce(prev: Record<string, RunView>, e: AgentEvent): Record<string, RunView> {
  const existing = prev[e.runId];
  if (existing && existing.events.some((x) => x.seq === e.seq)) return prev;
  const run: RunView = existing ?? {
    id: e.runId,
    title: e.type === "run_started" ? e.messageFa : "…",
    trigger: e.type === "run_started" ? e.trigger : "user",
    status: "running",
    startedAt: e.ts,
    events: [],
    pendingApproval: null,
  };
  const next: RunView = { ...run, events: [...run.events, e] };
  if (e.type === "status") next.status = e.status;
  if (e.type === "approval_required") next.pendingApproval = e.approval;
  if (e.type === "approval_resolved" || e.type === "summary") next.pendingApproval = null;
  return { ...prev, [e.runId]: next };
}

export async function postJson(url: string, data: unknown): Promise<{ ok: boolean; errorFa?: string; [k: string]: unknown }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok && body.ok !== false, ...body };
  } catch {
    return { ok: false, errorFa: "ارتباط با سرور برقرار نشد." };
  }
}
