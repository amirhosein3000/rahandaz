"use client";
import { useEffect, useState } from "react";
import { faDuration } from "@/lib/fa";
import { currentActivity, stagesFor } from "@/lib/stages";
import type { RunView } from "@/lib/use-console";
import { Fa } from "./fa";
import { Spinner } from "./ui";

const ICON: Record<string, string> = { done: "✓", failed: "!", waiting: "…", active: "", pending: "" };

/** Where are we, and is it waiting for me? Answered at a glance. */
export function Stepper({ run }: { run: RunView }) {
  const stages = stagesFor(run.events, run.status);
  const activity = currentActivity(run.events, run.status);
  const [now, setNow] = useState(Date.now());
  const live = run.status === "running" || run.status === "awaiting_approval";
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  const end = live ? now : Date.parse(run.events.at(-1)?.ts ?? run.startedAt);

  return (
    <div className="rounded-xl border border-line bg-surface p-3 shadow-card">
      <ol className="flex items-center gap-1 overflow-x-auto scroll-thin" aria-label="مراحل">
        {stages.map((s, i) => (
          <li key={s.key} className="flex min-w-0 shrink-0 items-center gap-1">
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
                s.state === "done"
                  ? "bg-ok text-white"
                  : s.state === "failed"
                    ? "bg-bad text-white"
                    : s.state === "waiting"
                      ? "bg-accent text-on-accent pulse-dot"
                      : s.state === "active"
                        ? "border-2 border-accent bg-accent-soft"
                        : "border border-line bg-surface-2 text-muted"
              }`}
              aria-hidden="true"
            >
              {s.state === "active" ? <Spinner /> : ICON[s.state]}
            </span>
            <span className={`whitespace-nowrap text-[12.5px] ${s.state === "pending" ? "text-muted" : "font-semibold"} ${s.state === "waiting" ? "text-accent" : ""}`}>{s.titleFa}</span>
            {i < stages.length - 1 && <span className={`mx-1 h-px w-5 shrink-0 sm:w-8 ${s.state === "done" ? "bg-ok" : "bg-line"}`} aria-hidden="true" />}
          </li>
        ))}
      </ol>
      {(activity || !live) && (
        <div className="mt-2 flex items-center gap-2 text-[12.5px] text-muted">
          {activity && run.status === "awaiting_approval" ? (
            <span className="font-semibold text-accent">⏸ منتظر تأیید شما؛ کارت تأیید پایین‌تر است.</span>
          ) : activity ? (
            <>
              <Spinner /> <Fa text={activity} />
            </>
          ) : null}
          <span className="ms-auto">{faDuration(end - Date.parse(run.startedAt))}</span>
        </div>
      )}
    </div>
  );
}
