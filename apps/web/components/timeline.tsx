"use client";
import { useEffect, useRef } from "react";
import type { AgentEvent, Diagnosis, DocHit, RepoAnalysis } from "@rahandaz/core";
import { faNum, faText, faTime, KIND_FA } from "@/lib/fa";
import type { RunView } from "@/lib/use-console";
import { DiffView, LogBlock } from "./code";
import { Badge, Dot, Spinner } from "./ui";

type Extra =
  | { kind: "logs"; source: "build" | "app"; lines: string[] }
  | { kind: "analysis"; analysis: RepoAnalysis }
  | { kind: "diagnosis"; diagnoses: Diagnosis[] }
  | { kind: "docs"; query: string; hits: DocHit[] }
  | { kind: "health"; ok: boolean; url: string; status?: number; latencyMs?: number; error?: string }
  | { kind: "release"; state: string; releaseId: string }
  | { kind: "injection"; source: string; rules: string[]; excerpt: string }
  | { kind: "blocked"; reasonFa: string };

interface Step {
  callId: string;
  tool: string;
  titleFa: string;
  kind: string;
  status: "running" | "ok" | "fail" | "waiting" | "blocked" | "dry";
  summaryFa?: string;
  ts: string;
  extras: Extra[];
}

function buildSteps(events: AgentEvent[]): Step[] {
  const steps: Step[] = [];
  const byId = new Map<string, Step>();
  let current: Step | undefined;
  for (const e of events) {
    switch (e.type) {
      case "tool_call": {
        const existing = byId.get(e.callId);
        if (existing) {
          existing.status = "running";
          current = existing;
        } else {
          const s: Step = { callId: e.callId, tool: e.tool, titleFa: e.titleFa, kind: e.kind, status: "running", ts: e.ts, extras: [] };
          byId.set(e.callId, s);
          steps.push(s);
          current = s;
        }
        break;
      }
      case "approval_required": {
        const s = byId.get(e.approval.toolCallId);
        if (s) s.status = "waiting";
        break;
      }
      case "approval_resolved": {
        if (e.decision === "denied" && current) current.status = "fail";
        break;
      }
      case "tool_result": {
        const s = byId.get(e.callId);
        if (s) {
          s.status = e.dryRun ? "dry" : e.ok ? "ok" : "fail";
          s.summaryFa = e.summaryFa;
        }
        break;
      }
      case "log": {
        if (!current) break;
        const last = current.extras[current.extras.length - 1];
        if (last?.kind === "logs" && last.source === e.source) last.lines = [...last.lines, ...e.lines];
        else current.extras.push({ kind: "logs", source: e.source, lines: [...e.lines] });
        break;
      }
      case "analysis":
        current?.extras.push({ kind: "analysis", analysis: e.analysis });
        break;
      case "diagnosis":
        current?.extras.push({ kind: "diagnosis", diagnoses: e.diagnoses });
        break;
      case "docs":
        current?.extras.push({ kind: "docs", query: e.query, hits: e.hits });
        break;
      case "health":
        current?.extras.push({ kind: "health", ...e.health });
        break;
      case "release": {
        if (!current) break;
        const prev = current.extras.find((x) => x.kind === "release" && x.releaseId === e.releaseId);
        if (prev && prev.kind === "release") prev.state = e.state;
        else current.extras.push({ kind: "release", state: e.state, releaseId: e.releaseId });
        break;
      }
      case "injection_warning":
        current?.extras.push({ kind: "injection", source: e.source, rules: e.findings.map((f) => f.rule), excerpt: e.findings[0]?.excerpt ?? "" });
        break;
      case "policy_blocked":
        if (current) {
          current.status = "blocked";
          current.extras.push({ kind: "blocked", reasonFa: e.reasonFa });
        } else {
          steps.push({ callId: `b${e.seq}`, tool: e.tool, titleFa: e.tool, kind: "destructive", status: "blocked", ts: e.ts, extras: [{ kind: "blocked", reasonFa: e.reasonFa }] });
        }
        break;
      default:
        break;
    }
  }
  return steps;
}

export function Timeline({ run }: { run: RunView | null }) {
  const end = useRef<HTMLDivElement>(null);
  const steps = run ? buildSteps(run.events) : [];
  const count = run?.events.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [count]);

  if (!run) {
    return (
      <div className="flex h-full min-h-60 flex-col items-center justify-center gap-2 p-8 text-center text-muted">
        <p className="text-sm">هنوز اجرایی شروع نشده.</p>
        <p className="text-xs">هر قدم ایجنت (ابزار، لاگ بیلد، تشخیص، تغییر کد) اینجا زنده نمایش داده می‌شود.</p>
      </div>
    );
  }

  return (
    <ol className="relative space-y-3 p-4">
      {steps.map((s) => (
        <li key={s.callId} className="relative ps-7">
          <span className="absolute start-0 top-1.5 flex size-5 items-center justify-center">
            {s.status === "running" ? <Spinner /> : <Dot tone={s.status === "ok" ? "ok" : s.status === "fail" || s.status === "blocked" ? "bad" : s.status === "waiting" ? "accent" : s.status === "dry" ? "info" : "neutral"} pulse={s.status === "waiting"} />}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-semibold leading-6">{faText(s.titleFa)}</span>
            <Badge tone={s.kind === "destructive" ? "bad" : s.kind === "read" ? "neutral" : "accent"}>{KIND_FA[s.kind] ?? s.kind}</Badge>
            {s.status === "waiting" && <Badge tone="accent">منتظر تأیید</Badge>}
            {s.status === "blocked" && <Badge tone="bad">مسدود</Badge>}
            {s.status === "dry" && <Badge tone="info">DRY_RUN</Badge>}
            <span className="ms-auto text-[11px] text-muted">{faTime(s.ts)}</span>
          </div>
          {s.summaryFa && <p className={`mt-0.5 text-[13px] ${s.status === "fail" ? "text-bad" : "text-muted"}`}>{faText(s.summaryFa)}</p>}
          {s.extras.length > 0 && (
            <div className="mt-2 space-y-2">
              {s.extras.map((x, i) => (
                <ExtraView key={i} x={x} />
              ))}
            </div>
          )}
        </li>
      ))}
      <div ref={end} />
    </ol>
  );
}

function ExtraView({ x }: { x: Extra }) {
  switch (x.kind) {
    case "logs":
      return <LogBlock lines={x.lines} title={`${x.source === "build" ? "لاگ بیلد" : "لاگ برنامه"} · ${faNum(x.lines.length)} خط`} />;
    case "analysis": {
      const a = x.analysis;
      return (
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-surface-2 p-3 text-[12.5px] sm:grid-cols-4">
          <Kv k="پشته" v={a.stackLabel} />
          <Kv k="پلتفرم" v={<code className="font-mono">{a.platform}</code>} />
          <Kv k="پورت" v={`${faNum(a.port)} · ${a.portSource}`} />
          <Kv k="شروع" v={<code className="font-mono">{a.startCommand ?? "-"}</code>} />
          <div className="col-span-2 sm:col-span-4">
            <span className="text-muted">متغیرها: </span>
            {a.env.length ? a.env.map((e) => <code key={e.name} className="me-1.5 font-mono">{e.name}</code>) : "ندارد"}
            {a.database.needed && <span className="ms-2 text-info">دیتابیس: {a.database.kind}</span>}
          </div>
        </div>
      );
    }
    case "diagnosis": {
      const top = x.diagnoses[0];
      if (!top) return <p className="text-[13px] text-muted">علت مشخصی پیدا نشد.</p>;
      return (
        <div className="space-y-2 rounded-lg border border-bad/30 bg-bad-soft/60 p-3">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-bold text-bad">ریشه‌ی مشکل: {faText(top.titleFa)}</span>
            <Badge tone="neutral">اطمینان {faNum(Math.round(top.confidence * 100))}٪</Badge>
          </div>
          <p className="text-[13px] leading-6">{faText(top.explanationFa)}</p>
          {top.evidence.length > 0 && (
            <pre className="scroll-thin overflow-auto rounded bg-code-bg px-2.5 py-1.5 font-mono text-[11.5px] leading-5 text-code-ink">{top.evidence.join("\n")}</pre>
          )}
          {top.fix?.files.map((f) => (
            <DiffView key={f.path} diff={f.diff} />
          ))}
          {top.fix?.env.map((e) => (
            <p key={e.key} className="text-[12.5px]">
              اصلاح پیشنهادی: تنظیم <code className="font-mono font-semibold">{e.key}</code> {e.overwrite && <Badge tone="bad">بازنویسی</Badge>}
            </p>
          ))}
        </div>
      );
    }
    case "docs":
      return (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="text-muted">مستندات لیارا:</span>
          {x.hits.map((h) => (
            <a key={h.url} href={h.url} target="_blank" rel="noreferrer" className="rounded-full border border-info/30 bg-info-soft px-2.5 py-0.5 text-info hover:underline" title={h.snippet}>
              {h.title}
            </a>
          ))}
        </div>
      );
    case "health":
      return (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] ${x.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>
          <Dot tone={x.ok ? "ok" : "bad"} />
          <span className="font-semibold">{x.ok ? "سالم" : "ناسالم"}</span>
          <code className="truncate font-mono text-[12px]" dir="ltr">{x.url}</code>
          <span className="ms-auto text-[12px]">{x.status ? faNum(x.status) : x.error}{x.latencyMs ? ` · ${faNum(x.latencyMs)}ms` : ""}</span>
        </div>
      );
    case "release":
      return (
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <span>ریلیز</span>
          <code className="font-mono">{x.releaseId}</code>
          <Badge tone={x.state === "READY" ? "ok" : ["FAILED", "UNHEALTHY", "CANCELED", "TIMEDOUT"].includes(x.state) ? "bad" : "accent"}>{x.state}</Badge>
        </div>
      );
    case "injection":
      return (
        <div className="rounded-lg border border-warn/40 bg-warn-soft p-2.5 text-[12.5px] text-warn">
          <div className="font-semibold">⚠ متن شبیه دستور به هوش مصنوعی در {x.source}؛ اجرا نشد، فقط داده است.</div>
          <div className="mt-1 font-mono text-[11px] opacity-80" dir="ltr">“{x.excerpt}”</div>
        </div>
      );
    case "blocked":
      return <div className="rounded-lg border border-bad/40 bg-bad-soft p-2.5 text-[12.5px] text-bad">⛔ {x.reasonFa}</div>;
  }
}

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted">{k}</div>
      <div className="truncate font-medium">{v}</div>
    </div>
  );
}
