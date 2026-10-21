"use client";
import { useEffect, useRef, useState } from "react";
import type { AgentEvent } from "@rahandaz/core";
import { faText } from "@/lib/fa";
import { postJson, type ConsoleState, type RunView } from "@/lib/use-console";
import { ApprovalCard } from "./approval-card";
import { SummaryCard } from "./summary-card";
import { Button } from "./ui";

export function ChatPanel({ run, state }: { run: RunView | null; state: ConsoleState | null }) {
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
    const res = await postJson("/api/runs", { message });
    setBusy(false);
    if (!res.ok) setError(res.errorFa ?? "خطا");
    else setText("");
  };

  const resolved = new Map<string, "approved" | "denied">();
  for (const e of run?.events ?? []) if (e.type === "approval_resolved") resolved.set(e.approvalId, e.decision);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {!run && <Welcome state={state} onPick={start} />}
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
            placeholder="لینک مخزن GitHub را بفرستید، یا بپرسید «چرا demo-shop از کار افتاده؟»"
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

function Welcome({ state, onPick }: { state: ConsoleState | null; onPick: (m: string) => void }) {
  const fixtures = state?.fixtures.filter((f) => f.failure) ?? [];
  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <h1 className="text-xl font-extrabold leading-9">لینک مخزن را بدهید؛ راهی آن را روی لیارا بالا می‌آورد و سالم نگه می‌دارد.</h1>
        <p className="text-[13.5px] leading-7 text-muted">
          تحلیل کد، نقشه‌ی استقرار با هزینه، دیپلوی بعد از تأیید شما، و اگر خطا داد: پیدا کردن ریشه با استناد به مستندات لیارا، پیشنهاد اصلاح به‌صورت diff، و دیپلوی دوباره. هیچ تغییری بدون تأیید شما انجام نمی‌شود.
        </p>
      </div>
      {fixtures.length > 0 && (
        <div>
          <div className="mb-2 text-xs text-muted">برای امتحان، یک مخزن نمونه‌ی خراب انتخاب کنید:</div>
          <div className="flex flex-wrap gap-2">
            {fixtures.map((f) => (
              <button
                key={f.name}
                type="button"
                onClick={() => onPick(`این مخزن را روی لیارا دیپلوی کن: https://github.com/rahandaz-demo/${f.name}`)}
                className={`rounded-full border px-3 py-1.5 text-[13px] transition hover:border-accent hover:text-accent ${f.hero ? "border-accent/50 bg-accent-soft text-accent" : "border-line bg-surface"}`}
              >
                {f.titleFa}
              </button>
            ))}
          </div>
        </div>
      )}
      <button type="button" onClick={() => onPick("چرا demo-shop کند است؟ وضعیتش را بررسی کن.")} className="text-[13px] text-info underline-offset-4 hover:underline">
        یا: «چرا demo-shop کند است؟»
      </button>
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
