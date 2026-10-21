"use client";
import { useState } from "react";
import type { ApprovalRequest } from "@rahandaz/core";
import { faNum, faText, KIND_FA, toman } from "@/lib/fa";
import { postJson } from "@/lib/use-console";
import { CallsList, DiffView } from "./code";
import { Badge, Button, Card } from "./ui";

export function ApprovalCard({ approval, resolved }: { approval: ApprovalRequest; resolved?: "approved" | "denied" | null }) {
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [confirmText, setConfirmText] = useState("");
  const [budgetOverride, setBudgetOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCalls, setShowCalls] = useState(false);
  const p = approval.plan;
  const destructive = approval.kind === "destructive";
  const pending = !resolved;

  const send = async (decision: "approved" | "denied") => {
    setBusy(true);
    setError(null);
    const res = await postJson(`/api/runs/${approval.runId}/approvals/${approval.id}`, { decision, confirmText, budgetOverride, secretValues: secrets });
    setBusy(false);
    if (!res.ok) setError(res.errorFa ?? "خطا");
  };

  const ready =
    approval.secretInputs.every((s) => secrets[s.key]?.trim()) &&
    (!approval.requireTypedConfirmation || confirmText.trim() === approval.requireTypedConfirmation) &&
    (!approval.requireBudgetOverride || budgetOverride);

  return (
    <Card tone={destructive ? "bad" : "accent"} className="overflow-hidden">
      <div className={`flex flex-wrap items-center gap-2 border-b px-4 py-2.5 ${destructive ? "border-bad/30 bg-bad-soft" : "border-accent/25 bg-accent-soft"}`}>
        <span className={`text-sm font-bold ${destructive ? "text-bad" : "text-accent"}`}>{destructive ? "تأیید عملیات حساس" : p ? "نقشه‌ی استقرار" : "درخواست تأیید"}</span>
        <Badge tone={destructive ? "bad" : "accent"}>{KIND_FA[approval.kind]}</Badge>
        {approval.dryRun && <Badge tone="info">DRY_RUN: چیزی اجرا نمی‌شود</Badge>}
        {resolved === "approved" && <Badge tone="ok">تأیید شد</Badge>}
        {resolved === "denied" && <Badge tone="bad">رد شد</Badge>}
      </div>

      <div className="space-y-3 p-4 text-sm">
        <p className="font-semibold leading-7">{faText(approval.titleFa)}</p>

        {p && (
          <div className="space-y-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-surface-2 p-3 text-[13px] sm:grid-cols-3">
              <Field k="اپ" v={<code className="font-mono">{p.appName}</code>} />
              <Field k="پلتفرم" v={<code className="font-mono">{p.platform}</code>} />
              <Field k="پورت" v={<span>{faNum(p.port)} <span className="text-muted">({p.portSourceFa})</span></span>} />
              <Field k="پلن" v={p.plan.labelFa} />
              <Field k="آدرس" v={<code className="font-mono text-[11px] break-all">{p.url}</code>} />
              <Field k="اپ موجود" v={p.appExists ? "بله، ریلیز جدید روی آن می‌رود" : "نه، ساخته می‌شود"} />
            </dl>

            <div>
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-xs text-muted">هزینه‌ی ماهانه‌ی تخمینی</span>
                <span className={`text-base font-bold ${p.overBudget ? "text-bad" : "text-ink"}`}>{toman(p.monthlyCostToman)}</span>
              </div>
              <ul className="space-y-0.5 text-xs text-muted">
                {p.costLines.map((l, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span>{faText(l.labelFa)}</span>
                    <span>{toman(l.toman)}</span>
                  </li>
                ))}
              </ul>
              {!p.pricesVerified && <p className="mt-1 text-[11px] text-warn">قیمت‌ها تخمینی‌اند و هنوز با قیمت رسمی لیارا تطبیق داده نشده‌اند.</p>}
              {p.overBudget && <p className="mt-1 text-[12px] font-semibold text-bad">از سقف بودجه ({toman(p.maxMonthlyCostToman)}) بیشتر است.</p>}
            </div>

            {p.env.length > 0 && (
              <div>
                <div className="mb-1 text-xs text-muted">متغیرهای محیطی (مقدارها هرگز به مدل زبانی نمی‌رسند)</div>
                <ul className="space-y-1 text-[13px]">
                  {p.env.map((e) => (
                    <li key={e.key} className="flex flex-wrap items-center gap-2">
                      <code className="font-mono font-semibold">{e.key}</code>
                      <span className="text-xs text-muted">{e.sourceFa}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {p.warnings.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-warn/40 bg-warn-soft p-2.5 text-[12.5px] text-warn">
                {p.warnings.map((w, i) => (
                  <li key={i}>⚠ {faText(w.messageFa)}</li>
                ))}
              </ul>
            )}
            {p.recommendationsFa.map((r, i) => (
              <p key={i} className="text-xs text-info">
                {faText(r)}
              </p>
            ))}

            <div>
              <div className="mb-1 text-xs text-muted">اقدام‌هایی که بعد از تأیید انجام می‌شود</div>
              <ol className="list-inside list-decimal space-y-0.5 text-[13px]">
                {p.actions.map((a, i) => (
                  <li key={i}>{faText(a.titleFa)}</li>
                ))}
              </ol>
            </div>
          </div>
        )}

        {approval.envRefs && approval.envRefs.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-surface-2 p-2.5 text-[13px]">
            {approval.envRefs.map((e) => (
              <li key={e.key} className="flex flex-wrap items-center gap-2">
                <code className="font-mono font-semibold">{e.key}</code>
                {e.overwrite && <Badge tone="bad">بازنویسی مقدار فعلی</Badge>}
                <span className="text-xs text-muted">{faText(e.labelFa)}</span>
              </li>
            ))}
          </ul>
        )}

        {approval.diffs?.map((d) => (
          <div key={d.path}>
            <div className="mb-1 font-mono text-xs text-muted" dir="ltr">
              {d.path}
            </div>
            <DiffView diff={d.diff} />
          </div>
        ))}

        <div>
          <button type="button" className="text-xs text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => setShowCalls((s) => !s)}>
            {showCalls ? "پنهان‌کردن" : "نمایش"} فراخوانی‌های دقیق API ({faNum(approval.calls.length)})
          </button>
          {showCalls && <div className="mt-1.5"><CallsList calls={approval.calls} /></div>}
        </div>

        {approval.taintedWarningFa && <p className="rounded-lg border border-warn/40 bg-warn-soft p-2.5 text-[12.5px] text-warn">⚠ {approval.taintedWarningFa}</p>}

        {pending && (
          <div className="space-y-2.5">
            {approval.secretInputs.map((s) => (
              <label key={s.key} className="block">
                <span className="mb-1 block text-xs">
                  مقدار <code className="font-mono font-semibold">{s.key}</code> <span className="text-muted">· {s.labelFa}</span>
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  dir="ltr"
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                  value={secrets[s.key] ?? ""}
                  onChange={(e) => setSecrets({ ...secrets, [s.key]: e.target.value })}
                />
              </label>
            ))}
            {approval.requireTypedConfirmation && (
              <label className="block">
                <span className="mb-1 block text-xs text-bad">
                  برای تأیید، نام <code className="font-mono font-bold">{approval.requireTypedConfirmation}</code> را دقیقاً تایپ کنید
                </span>
                <input
                  dir="ltr"
                  autoComplete="off"
                  className="w-full rounded-lg border border-bad/50 bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-bad"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                />
              </label>
            )}
            {approval.requireBudgetOverride && (
              <label className="flex items-center gap-2 text-[13px] text-bad">
                <input type="checkbox" checked={budgetOverride} onChange={(e) => setBudgetOverride(e.target.checked)} className="size-4 accent-[var(--bad)]" />
                آگاهانه از سقف بودجه عبور می‌کنم
              </label>
            )}
            {error && <p className="text-[13px] text-bad">{error}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant={destructive ? "danger" : "primary"} onClick={() => send("approved")} disabled={busy || !ready}>
                {approval.dryRun ? "تأیید (فقط نمایش)" : destructive ? "تأیید و اجرا" : p ? "تأیید نقشه و شروع" : "تأیید و اجرا"}
              </Button>
              <Button variant="secondary" onClick={() => send("denied")} disabled={busy}>
                رد
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted">{k}</dt>
      <dd className="truncate font-medium">{v}</dd>
    </div>
  );
}
