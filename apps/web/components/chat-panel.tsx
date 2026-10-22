"use client";
import { useEffect, useRef, useState } from "react";
import type { AgentEvent } from "@rahandaz/core";
import { faText } from "@/lib/fa";
import { postJson, type RunView } from "@/lib/use-console";
import { ApprovalCard } from "./approval-card";
import { CiCard } from "./ci-card";
import { DomainCard } from "./domain-card";
import { SreReportCard } from "./sre-report";
import { SummaryCard } from "./summary-card";
import { Button } from "./ui";

/** Events that show up in the conversation (everything else lives on the technical timeline). */
const SHOWN = new Set(["run_started", "user", "assistant", "approval_required", "sre_report", "domain_status", "ci_setup", "summary", "error"]);

export function ChatPanel({ run }: { run: RunView | null }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const count = run?.events.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [count]);

  const finished = Boolean(run && (run.status === "completed" || run.status === "failed" || run.status === "stopped"));
  const start = async (message: string) => {
    if (!message.trim()) return;
    setBusy(true);
    setError(null);
    // A finished conversation continues (e.g. "done" after changing nameservers); otherwise start a new one.
    const res = finished && run ? await postJson(`/api/runs/${run.id}/message`, { text: message }) : await postJson("/api/runs", { message });
    setBusy(false);
    if (!res.ok) setError(res.errorFa ?? "خطا");
    else setText("");
  };
  const prefill = (t: string) => {
    setText(t);
    requestAnimationFrame(() => {
      input.current?.focus();
      // Select the placeholder part (e.g. the example domain) so typing replaces it.
      const at = t.indexOf("example.ir");
      if (at >= 0) input.current?.setSelectionRange(at, at + "example.ir".length);
    });
  };

  // A domain checklist is a living status: show only its latest version.
  const lastDomainSeq = [...(run?.events ?? [])].reverse().find((e) => e.type === "domain_status")?.seq;
  const resolved = new Map<string, "approved" | "denied">();
  for (const e of run?.events ?? []) if (e.type === "approval_resolved") resolved.set(e.approvalId, e.decision);
  // A follow-up turn ends with a fresh summary card: show only the latest one, not a stack of repeats.
  const lastSummarySeq = [...(run?.events ?? [])].reverse().find((e) => e.type === "summary")?.seq;
  const shown = (run?.events ?? []).filter(
    (e) => SHOWN.has(e.type) && !(e.type === "domain_status" && e.seq !== lastDomainSeq) && !(e.type === "summary" && e.seq !== lastSummarySeq),
  );
  const lastSummary = [...shown].reverse().find((e) => e.type === "summary");
  const suggestions = finished && lastSummary?.type === "summary" ? nextSteps(lastSummary.card) : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
        {shown.map((e, i) => (
          <Message key={e.seq} e={e} resolved={resolved} grouped={e.type === "assistant" && shown[i - 1]?.type === "assistant"} />
        ))}
        {run && run.status === "running" && (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <span className="pulse-dot">●</span> راهی در حال کار است…
          </div>
        )}
        {suggestions.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <div className="text-[12.5px] text-muted">قدم بعدی؟</div>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  disabled={busy}
                  onClick={() => (s.send ? void start(s.send) : prefill(s.prefill ?? ""))}
                  className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] shadow-card transition hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div ref={end} />
      </div>

      <form
        className="border-t border-line bg-surface p-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          void start(text);
        }}
      >
        {error && <p className="mb-2 text-[13px] text-bad">{error}</p>}
        <div className="flex items-end gap-2">
          <textarea
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void start(text);
              }
            }}
            rows={2}
            placeholder={run && (run.status === "running" || run.status === "awaiting_approval") ? "راهی در حال کار است…" : "سؤالی دارید یا کار دیگری هست؟ بنویسید…"}
            className="min-h-11 flex-1 resize-none rounded-lg border border-line bg-bg px-3 py-2 text-sm leading-6 outline-none placeholder:text-muted focus:border-accent"
            aria-label="پیام به ایجنت"
          />
          <Button type="submit" disabled={busy || !text.trim()}>
            ارسال
          </Button>
        </div>
      </form>
    </div>
  );
}

type Suggestion = { label: string; send?: string; prefill?: string };

/** What a non-engineer would naturally want after this outcome. */
function nextSteps(card: Extract<AgentEvent, { type: "summary" }>["card"]): Suggestion[] {
  const app = card.appName;
  if (!app) return [];
  if (card.outcome === "healthy") {
    return [
      { label: "🌐 وصل کردن دامنه‌ی خودم", prefill: `دامنه‌ی example.ir را به اپ ${app} وصل کن` },
      { label: "🔁 انتشار خودکار با هر تغییر", send: `استقرار خودکار با هر push برای اپ ${app}` },
      { label: "🩺 بررسی سلامت سایت", send: `بررسی کامل سلامت اپ ${app}: لاگ‌ها، منابع و خطاها` },
    ];
  }
  if (card.outcome === "failed") return [{ label: "🩺 دوباره بررسی کن", send: `بررسی کامل سلامت اپ ${app}: لاگ‌ها، منابع و خطاها` }];
  return [];
}

function Message({ e, resolved, grouped }: { e: AgentEvent; resolved: Map<string, "approved" | "denied">; grouped: boolean }) {
  switch (e.type) {
    case "run_started":
      if (e.trigger === "incident") {
        return (
          <div className="rounded-xl border border-bad/40 bg-bad-soft px-4 py-3 text-[13.5px] leading-7 text-bad">
            <div className="text-xs font-bold">نگهبان سلامت · شروع خودکار</div>
            {faText(e.messageFa)}
          </div>
        );
      }
      return <UserBubble text={e.messageFa} />;
    case "user":
      return <UserBubble text={e.text} />;
    case "assistant":
      // Consecutive messages read as one turn: one avatar, tighter spacing.
      return (
        <div className={`flex gap-2.5 ${grouped ? "-mt-1.5" : ""}`}>
          <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${grouped ? "invisible" : "bg-ink text-bg"}`} aria-hidden={grouped}>
            ر
          </span>
          <div className="min-w-0 flex-1 whitespace-pre-wrap rounded-2xl rounded-ss-sm bg-surface px-4 py-2.5 text-[14px] leading-7 shadow-card [overflow-wrap:anywhere]">
            {linkify(faText(e.text))}
          </div>
        </div>
      );
    case "approval_required":
      return <ApprovalCard approval={e.approval} resolved={resolved.get(e.approval.id) ?? null} />;
    case "sre_report":
      return <SreReportCard report={e.report} />;
    case "domain_status":
      return <DomainCard status={e.status} />;
    case "ci_setup":
      return <CiCard setup={e.setup} />;
    case "summary":
      return <SummaryCard card={e.card} />;
    case "error":
      return <p className="text-[13px] text-bad">{e.messageFa}</p>;
    default:
      return null;
  }
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-se-sm bg-accent px-4 py-2.5 text-[14px] leading-7 text-on-accent [overflow-wrap:anywhere]">{text}</div>
    </div>
  );
}

/** Links read as words: Liara docs become a «راهنمای لیارا» chip, other URLs show only their address. */
function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s،)]+)/g);
  return parts.map((p, i) => {
    if (!/^https?:\/\//.test(p)) return <span key={i}>{p}</span>;
    if (/^https?:\/\/docs\.liara\.ir\//.test(p)) {
      return (
        <a key={i} href={p} target="_blank" rel="noreferrer" className="mx-0.5 inline-block rounded-full border border-info/30 bg-info-soft px-2.5 py-0.5 text-[12.5px] text-info hover:underline">
          📄 راهنمای لیارا ↗
        </a>
      );
    }
    return (
      <a key={i} href={p} target="_blank" rel="noreferrer" className="font-mono text-[12.5px] text-accent underline-offset-4 hover:underline" dir="ltr">
        {p.replace(/^https?:\/\//, "").replace(/\/$/, "")}
      </a>
    );
  });
}
