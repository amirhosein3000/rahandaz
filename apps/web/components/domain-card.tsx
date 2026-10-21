"use client";
import { useState } from "react";
import type { DomainStatus } from "@rahandaz/core";
import { Fa } from "./fa";
import { Card } from "./ui";

/** Domain connection as a checklist: who does each step, and the exact values to paste. */
export function DomainCard({ status }: { status: DomainStatus }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (v: string) =>
    void navigator.clipboard?.writeText(v).then(() => {
      setCopied(v);
      setTimeout(() => setCopied(null), 1500);
    });
  const allDone = status.steps.every((s) => s.done);

  return (
    <Card tone={allDone ? "ok" : status.next.who === "user" ? "accent" : "neutral"} className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <span className="text-[15px] font-extrabold">اتصال دامنه</span>
        <code className="font-mono text-[13px]" dir="ltr">
          {status.domain}
        </code>
        <span className="text-[12px] text-muted">← {status.app}</span>
      </div>
      <ol className="space-y-2.5 p-4">
        {status.steps.map((s) => (
          <li key={s.key} className="flex gap-3">
            <span
              className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${s.done ? "bg-ok text-white" : s.who === "user" ? "bg-accent text-on-accent" : "border border-line bg-surface-2 text-muted"}`}
              aria-hidden="true"
            >
              {s.done ? "✓" : s.who === "user" ? "👤" : "🤖"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold">
                {s.titleFa}
                {!s.done && <span className={`text-[11.5px] font-normal ${s.who === "user" ? "text-accent" : "text-muted"}`}>{s.who === "user" ? "کار شما" : "با دستیار"}</span>}
              </div>
              <p className="text-[12.5px] text-muted">
                <Fa text={s.detailFa} />
              </p>
              {!s.done && s.who === "user" && s.values && s.values.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  {s.values.map((v) => (
                    <div key={v.text} className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5">
                      <span className="text-[11.5px] text-muted">{v.labelFa}</span>
                      <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] font-semibold" dir="ltr">
                        {v.text}
                      </code>
                      <button type="button" onClick={() => copy(v.text)} className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[11.5px] hover:border-accent hover:text-accent">
                        {copied === v.text ? "کپی شد" : "کپی"}
                      </button>
                    </div>
                  ))}
                  <a href="https://nic.ir" target="_blank" rel="noreferrer" className="inline-block text-[12px] text-info underline-offset-4 hover:underline">
                    رفتن به پنل ایرنیک (nic.ir) ↗
                  </a>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className={`border-t border-line px-4 py-2.5 text-[13px] ${allDone ? "bg-ok-soft text-ok" : status.next.who === "user" ? "bg-accent-soft" : ""}`}>
        <Fa text={status.next.textFa} />
      </div>
      <details className="border-t border-line px-4 py-2 text-[12px] text-muted">
        <summary className="cursor-pointer select-none">ⓘ محدودیت‌ها</summary>
        <ul className="mt-1 space-y-0.5">
          {status.limitationsFa.map((l, i) => (
            <li key={i}>• {l}</li>
          ))}
        </ul>
      </details>
    </Card>
  );
}
