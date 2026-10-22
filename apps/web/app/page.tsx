"use client";
import { useState } from "react";
import { ChatPanel } from "@/components/chat-panel";
import { Header } from "@/components/header";
import { Home } from "@/components/home";
import { Stepper } from "@/components/stepper";
import { Timeline } from "@/components/timeline";
import { Badge, Button } from "@/components/ui";
import { STATUS_FA } from "@/lib/fa";
import { postJson, useConsole } from "@/lib/use-console";
import { useTechView } from "@/lib/view";

export default function ConsolePage() {
  const { state, runs, current, select, connected } = useConsole();
  const [tab, setTab] = useState<"chat" | "timeline">("chat");
  const [tech] = useTechView();

  if (!current) {
    return (
      <div className="min-h-dvh">
        <Header state={state} connected={connected} active="console" />
        <Home state={state} runs={runs} onOpen={select} />
      </div>
    );
  }

  const live = current.status === "running" || current.status === "awaiting_approval";
  const bar = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" onClick={() => select("")}>
        → خانه
      </Button>
      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
        {current.trigger === "incident" ? "🚨 " : ""}
        {current.title}
      </span>
      <Badge tone={current.status === "completed" ? "ok" : current.status === "failed" ? "bad" : "accent"}>{STATUS_FA[current.status]}</Badge>
      {live && (
        <Button variant="ghost" onClick={() => void postJson(`/api/runs/${current.id}/stop`, {})}>
          توقف
        </Button>
      )}
    </div>
  );

  if (!tech) {
    // Simple view: one conversation, nothing technical on screen.
    return (
      <div className="flex min-h-dvh flex-col lg:h-dvh">
        <Header state={state} connected={connected} active="console" />
        <div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col gap-3 px-3 py-3 sm:px-4">
          {bar}
          <Stepper run={current} />
          <section className="flex h-[80dvh] min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface-2/40 lg:h-auto lg:flex-1" aria-label="گفتگو">
            <ChatPanel run={current} />
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <Header state={state} connected={connected} active="console" />

      <div className="mx-auto flex w-full max-w-[1500px] min-h-0 flex-1 flex-col gap-3 px-3 py-3 sm:px-4">
        {bar}

        <Stepper run={current} />

        {/* Phone: tabs. Laptop: side by side (conversation on the right in RTL). */}
        <div className="flex gap-1 rounded-lg bg-surface-2 p-1 lg:hidden" role="tablist">
          {(["chat", "timeline"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`flex-1 rounded-md py-1.5 text-[13px] ${tab === t ? "bg-surface font-semibold shadow-card" : "text-muted"}`}>
              {t === "chat" ? "گفتگو و تأییدها" : "جزئیات فنی"}
            </button>
          ))}
        </div>

        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:grid-rows-[minmax(0,1fr)]">
          <section className={`h-[78dvh] min-h-0 overflow-hidden rounded-xl border border-line bg-surface-2/40 lg:h-auto ${tab === "chat" ? "flex" : "hidden"} flex-col lg:flex`} aria-label="گفتگو">
            <ChatPanel run={current} />
          </section>
          <section className={`scroll-thin h-[78dvh] min-h-0 overflow-y-auto rounded-xl border border-line bg-surface lg:h-auto ${tab === "timeline" ? "block" : "hidden"} lg:block`} aria-label="جزئیات فنی">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur">
              <span className="text-sm font-bold">جزئیات فنی</span>
              <span className="text-[11.5px] text-muted">هر قدم، لاگ‌ها و فراخوانی‌های API</span>
            </div>
            <Timeline run={current} />
          </section>
        </div>
      </div>
    </div>
  );
}
