"use client";
import { useEffect, useRef, useState } from "react";
import type { AgentEvent } from "@rahandaz/core";
import { faText } from "@/lib/fa";
import { postJson, type RunView } from "@/lib/use-console";
import { ApprovalCard } from "./approval-card";
import { DomainCard } from "./domain-card";
import { SreReportCard } from "./sre-report";
import { SummaryCard } from "./summary-card";
import { Button } from "./ui";

export function ChatPanel({ run }: { run: RunView | null }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const count = run?.events.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [count]);

  const start = async (message: string) => {
    if (!message.trim()) return;
    setBusy(true);
    setError(null);
    // A finished conversation continues (e.g. "done" after changing nameservers); otherwise start a new one.
    const finished = run && (run.status === "completed" || run.status === "failed" || run.status === "stopped");
    const res = finished ? await postJson(`/api/runs/${run.id}/message`, { text: message }) : await postJson("/api/runs", { message });
    setBusy(false);
    if (!res.ok) setError(res.errorFa ?? "خطا");
    else setText("");
  };

  const resolved = new Map<string, "approved" | "denied">();
  for (const e of run?.events ?? []) if (e.type === "approval_resolved") resolved.set(e.approvalId, e.decision);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {run?.events.map((e) => <Message key={e.seq} e={e} resolved={resolved} />)}
        {run && (run.status === "running") && (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <span className="pulse-dot">●</span> راهی در حال کار است…
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
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void start(text);
              }
            }}
            rows={2}
            placeholder={run && (run.status === "running" || run.status === "awaiting_approval") ? "راهی در حال کار است…" : "ادامه‌ی گفتگو؛ مثلاً «انجام دادم» یا یک سؤال تازه"}
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

function Message({ e, resolved }: { e: AgentEvent; resolved: Map<string, "approved" | "denied"> }) {
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
      return (
        <div className="flex gap-2.5">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-bold text-bg">ر</span>
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

function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s،)]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noreferrer" className="font-mono text-[12.5px] text-accent underline-offset-4 hover:underline" dir="ltr">
        {p}
      </a>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}
