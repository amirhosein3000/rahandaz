"use client";
import { useState } from "react";
import type { SreReport } from "@rahandaz/core";
import { faNum, toman } from "@/lib/fa";
import { Fa } from "./fa";
import { Badge, Card } from "./ui";

const SEV = {
  critical: { dot: "bg-bad", text: "text-bad", label: "بحرانی" },
  warning: { dot: "bg-warn", text: "text-warn", label: "هشدار" },
  ok: { dot: "bg-ok", text: "text-ok", label: "سالم" },
  unknown: { dot: "bg-muted", text: "text-muted", label: "نامشخص" },
} as const;

const STATUS = {
  healthy: { label: "سالم", tone: "ok" as const },
  degraded: { label: "مشکل دارد", tone: "warn" as const },
  down: { label: "از دسترس خارج", tone: "bad" as const },
};

function ScoreRing({ score }: { score: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const color = score >= 85 ? "var(--ok)" : score >= 55 ? "var(--warn)" : "var(--bad)";
  return (
    <div className="relative size-16 shrink-0" role="img" aria-label={`امتیاز سلامت ${score} از ۱۰۰`}>
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--line)" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[17px] font-extrabold">{faNum(score)}</span>
    </div>
  );
}

/** The SRE agent's report: what was checked, what is wrong, why, and what to do. */
export function SreReportCard({ report }: { report: SreReport }) {
  const [open, setOpen] = useState<number | null>(0);
  const st = STATUS[report.status];
  return (
    <Card tone={st.tone === "ok" ? "ok" : st.tone === "bad" ? "bad" : "warn"} className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line p-4">
        <ScoreRing score={report.compare?.scoreAfter ?? report.score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-extrabold">گزارش سلامت</span>
            <code className="font-mono text-[12.5px] text-muted">{report.app}</code>
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
          <p className="mt-1 text-[13.5px] leading-6">
            <Fa text={report.headlineFa} />
          </p>
        </div>
      </div>

      {report.compare && (
        <div className={`border-b border-line px-4 py-3 text-[13px] ${report.compare.resolved ? "bg-ok-soft" : "bg-warn-soft"}`}>
          <div className={`font-bold ${report.compare.resolved ? "text-ok" : "text-warn"}`}>
            {report.compare.resolved ? "✓ اصلاح جواب داد" : "هنوز کامل حل نشده"} · امتیاز {faNum(report.compare.scoreBefore)} ← {faNum(report.compare.scoreAfter)}
          </div>
          <ul className="mt-1 space-y-0.5">
            {report.compare.changesFa.map((c, i) => (
              <li key={i}>
                • <Fa text={c} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-line p-4 sm:grid-cols-4">
        {report.checks.map((c) => (
          <div key={c.id} className="min-w-0" title={c.detailFa}>
            <div className="flex items-center gap-1.5 text-[12px] text-muted">
              <span className={`size-2 rounded-full ${SEV[c.severity].dot}`} aria-hidden="true" />
              {c.titleFa}
            </div>
            <div className={`truncate text-[12.5px] font-medium ${c.severity === "ok" ? "" : SEV[c.severity].text}`}>
              <Fa text={c.detailFa} />
            </div>
          </div>
        ))}
      </div>

      {report.hypotheses.length > 0 && (
        <div className="p-4">
          <div className="mb-2 text-[13px] font-bold">{report.status === "healthy" ? "پیشنهادها" : "علت‌های احتمالی (به ترتیب احتمال)"}</div>
          <ol className="space-y-2">
            {report.hypotheses.slice(0, 4).map((h, i) => (
              <li key={h.id} className="rounded-lg border border-line bg-surface-2/60">
                <button type="button" onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center gap-3 px-3 py-2 text-start" aria-expanded={open === i}>
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-bold text-bg">{faNum(i + 1)}</span>
                  <span className="min-w-0 flex-1 text-[13.5px] font-semibold">
                    <Fa text={h.titleFa} />
                  </span>
                  <span className="hidden w-24 shrink-0 sm:block" aria-hidden="true">
                    <span className="block h-1.5 overflow-hidden rounded-full bg-line">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(h.likelihood * 100)}%` }} />
                    </span>
                  </span>
                  <span className="w-10 shrink-0 text-left text-[12px] text-muted">{faNum(Math.round(h.likelihood * 100))}٪</span>
                </button>
                {open === i && (
                  <div className="space-y-2 border-t border-line px-3 py-2.5 text-[13px] leading-6">
                    <p>
                      <Fa text={h.explanationFa} />
                    </p>
                    {h.evidence.length > 0 && (
                      <div>
                        <div className="text-[11.5px] text-muted">شواهد</div>
                        <pre className="scroll-thin mt-0.5 overflow-auto rounded bg-code-bg px-2.5 py-1.5 font-mono text-[11.5px] leading-5 whitespace-pre-wrap break-all text-code-ink">{h.evidence.join("\n")}</pre>
                      </div>
                    )}
                    {h.action && (
                      <div className="rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-[13px]">
                        <span className="font-semibold text-accent">اقدام پیشنهادی: </span>
                        <Fa text={h.action.titleFa} />
                        {h.action.costDeltaToman ? <span className="text-muted"> · {h.action.costDeltaToman > 0 ? "+" : "−"}{toman(Math.abs(h.action.costDeltaToman))} در ماه</span> : null}
                        <div className="text-[11.5px] text-muted">فقط با تأیید شما اجرا می‌شود.</div>
                      </div>
                    )}
                    {h.guidanceFa.length > 0 && (
                      <div>
                        <div className="text-[11.5px] text-muted">{h.action ? "نکته" : "کارهایی که خودتان باید انجام دهید"}</div>
                        <ul className="mt-0.5 space-y-0.5">
                          {h.guidanceFa.map((g, j) => (
                            <li key={j}>
                              • <Fa text={g} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {h.docs?.map((d) => (
                      <a key={d.url} href={d.url} target="_blank" rel="noreferrer" className="inline-block rounded-full border border-info/30 bg-info-soft px-2.5 py-0.5 text-[12px] text-info hover:underline">
                        📄 {d.title}
                      </a>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {report.logs.http.requests > 0 && (
        <div className="border-t border-line px-4 py-2.5 text-[12px] text-muted">
          لاگ {faNum(report.logs.windowMinutes)} دقیقه‌ی اخیر: {faNum(report.logs.http.requests)} درخواست، {faNum(report.logs.http.errors5xx)} خطای ۵xx
          {report.logs.http.p95Ms ? `، صدک ۹۵ زمان پاسخ ${faNum(Math.round(report.logs.http.p95Ms))}ms` : ""}
          {report.logs.clusters.length ? `، ${faNum(report.logs.clusters.length)} نوع خطای تکراری` : ""}
        </div>
      )}

      {report.limitationsFa.length > 0 && (
        <details className="border-t border-line px-4 py-2.5 text-[12px] text-muted">
          <summary className="cursor-pointer select-none">ⓘ محدودیت‌ها: چه چیزهایی از API لیارا قابل دیدن نبود ({faNum(report.limitationsFa.length)})</summary>
          <ul className="mt-1 space-y-0.5">
            {report.limitationsFa.map((l, i) => (
              <li key={i}>
                • <Fa text={l} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
