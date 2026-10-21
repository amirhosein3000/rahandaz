"use client";
import { useState } from "react";
import { BreakPanel } from "@/components/break-panel";
import { ChatPanel } from "@/components/chat-panel";
import { Header } from "@/components/header";
import { Timeline } from "@/components/timeline";
import { Badge, Button } from "@/components/ui";
import { faTime, STATUS_FA } from "@/lib/fa";
import { postJson, useConsole } from "@/lib/use-console";

export default function ConsolePage() {
  const { state, runs, current, select, connected } = useConsole();
  const [tab, setTab] = useState<"chat" | "timeline">("chat");

  return (
    <div className="flex h-dvh flex-col">
      <Header state={state} connected={connected} active="console" />

      <div className="mx-auto flex w-full max-w-[1500px] min-h-0 flex-1 flex-col gap-3 px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-0 items-center gap-2 text-[13px]">
            <span className="text-muted">اجرا:</span>
            <select
              value={current?.id ?? ""}
              onChange={(e) => select(e.target.value)}
              className="min-w-0 max-w-[60vw] truncate rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px] sm:max-w-md"
              aria-label="انتخاب اجرا"
            >
              {!current && <option value="">اجرای جدید</option>}
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.trigger === "incident" ? "🚨 " : ""}
                  {r.title.slice(0, 60)} · {STATUS_FA[r.status]} · {faTime(r.startedAt)}
                </option>
              ))}
            </select>
          </label>
          {current && <Badge tone={current.status === "completed" ? "ok" : current.status === "failed" ? "bad" : "accent"}>{STATUS_FA[current.status]}</Badge>}
          {current && (current.status === "running" || current.status === "awaiting_approval") && (
            <Button variant="ghost" onClick={() => void postJson(`/api/runs/${current.id}/stop`, {})}>
              توقف
            </Button>
          )}
          {current && (
            <Button variant="ghost" onClick={() => select("")}>
              + گفتگوی جدید
            </Button>
          )}
        </div>

        <BreakPanel state={state} runs={runs} />

        {/* Phone: tabs. Laptop: side by side (chat on the right in RTL). */}
        <div className="flex gap-1 rounded-lg bg-surface-2 p-1 lg:hidden" role="tablist">
          {(["chat", "timeline"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`flex-1 rounded-md py-1.5 text-[13px] ${tab === t ? "bg-surface font-semibold shadow-card" : "text-muted"}`}>
              {t === "chat" ? "گفتگو و تأییدها" : "تایم‌لاین ایجنت"}
            </button>
          ))}
        </div>

        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <section className={`min-h-0 overflow-hidden rounded-xl border border-line bg-surface-2/40 ${tab === "chat" ? "flex" : "hidden"} flex-col lg:flex`} aria-label="گفتگو">
            <ChatPanel run={current} state={state} />
          </section>
          <section className={`scroll-thin min-h-0 overflow-y-auto rounded-xl border border-line bg-surface ${tab === "timeline" ? "block" : "hidden"} lg:block`} aria-label="تایم‌لاین">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur">
              <span className="text-sm font-bold">تایم‌لاین زنده</span>
              <span className="text-[11.5px] text-muted">ابزارها · لاگ‌ها · تشخیص · تغییرات</span>
            </div>
            <Timeline run={current} />
          </section>
        </div>
      </div>
    </div>
  );
}
