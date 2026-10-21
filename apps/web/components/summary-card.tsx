"use client";
import { useState } from "react";
import type { SummaryCard as Summary } from "@rahandaz/core";
import { faDuration, faNum, OUTCOME_FA, toman } from "@/lib/fa";
import { Fa } from "./fa";
import { Button, Card, Logo } from "./ui";

/** End-of-run card. Built from run state on the server, not from model text. */
export function SummaryCard({ card }: { card: Summary }) {
  const [copied, setCopied] = useState(false);
  const good = card.outcome === "healthy";
  const tone = good ? "ok" : card.outcome === "failed" ? "bad" : "info";

  const text = [
    `راه‌انداز · ${OUTCOME_FA[card.outcome]}`,
    card.appName ? `اپ: ${card.appName}${card.url ? ` · ${card.url}` : ""}` : "",
    card.repo ? `مخزن: ${card.repo}${card.stack ? ` (${card.stack})` : ""}` : "",
    card.rootCauseFa ? `ریشه‌ی مشکل: ${card.rootCauseFa}` : "",
    ...card.fixesFa.map((f) => `اصلاح: ${f}`),
    card.monthlyCostToman ? `هزینه‌ی ماهانه: ${toman(card.monthlyCostToman)}${card.pricesVerified ? "" : " (تخمینی)"}` : "",
    `زمان: ${faDuration(card.durationMs)} · تأییدها: ${faNum(card.approvals)}`,
    ...card.docs.map((d) => `مستند: ${d.url}`),
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <Card tone={tone} className="overflow-hidden">
      <div className={`flex items-center justify-between gap-3 px-4 py-3 ${good ? "bg-ok-soft" : card.outcome === "failed" ? "bg-bad-soft" : "bg-info-soft"}`}>
        <div className="flex items-center gap-2.5">
          <Logo size={26} />
          <div>
            <div className={`text-base font-extrabold ${good ? "text-ok" : card.outcome === "failed" ? "text-bad" : "text-info"}`}>{OUTCOME_FA[card.outcome]}</div>
            {card.appName && <div className="font-mono text-xs text-muted" dir="ltr">{card.appName}</div>}
          </div>
        </div>
        <div className="text-left text-xs text-muted">
          <div>{faDuration(card.durationMs)}</div>
          <div>{faNum(card.approvals)} تأیید · {faNum(card.steps)} گام</div>
        </div>
      </div>
      <div className="space-y-2.5 p-4 text-sm">
        {card.url && good && (
          <a href={card.url} target="_blank" rel="noreferrer" className="block truncate font-mono text-[13px] font-semibold text-accent underline-offset-4 hover:underline" dir="ltr">
            {card.url}
          </a>
        )}
        {card.rootCauseFa && (
          <p>
            <span className="text-muted">ریشه‌ی مشکل: </span>
            <Fa text={card.rootCauseFa} />
          </p>
        )}
        {card.fixesFa.length > 0 && (
          <ul className="space-y-0.5">
            {card.fixesFa.map((f, i) => (
              <li key={i}>✓ <Fa text={f} /></li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
          {card.stack && <span><span className="text-muted">پشته: </span>{card.stack}</span>}
          {card.monthlyCostToman !== null && (
            <span>
              <span className="text-muted">هزینه: </span>
              {toman(card.monthlyCostToman)}
              {!card.pricesVerified && <span className="text-muted"> (تخمینی)</span>}
            </span>
          )}
          {card.healAttempts > 0 && <span><span className="text-muted">اصلاح خودکار: </span>{faNum(card.healAttempts)}</span>}
        </div>
        {card.docs.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {card.docs.map((d) => (
              <a key={d.url} href={d.url} target="_blank" rel="noreferrer" className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-[12px] hover:border-accent hover:text-accent">
                📄 {d.title}
              </a>
            ))}
          </div>
        )}
        {(card.outcome === "failed" || card.outcome === "stopped") && card.applied.length > 0 && (
          <div className="rounded-lg border border-warn/40 bg-warn-soft p-2.5 text-[12.5px]">
            <div className="mb-1 font-semibold text-warn">تغییرهایی که اعمال شده و راه برگرداندنشان</div>
            <ul className="space-y-1">
              {card.applied.map((a, i) => (
                <li key={i}>
                  • <Fa text={a.titleFa} />
                  {a.undoFa && <span className="text-muted"> ← <Fa text={a.undoFa} /></span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {card.ignoredInjection &&<p className="text-[12px] text-warn">در مسیر کار، متن‌هایی شبیه دستور به هوش مصنوعی دیده شد که اجرا نشدند.</p>}
        <div className="pt-1">
          <Button
            variant="secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              });
            }}
          >
            {copied ? "کپی شد ✓" : "کپی خلاصه برای اشتراک"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
