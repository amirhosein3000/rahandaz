"use client";
import { useState } from "react";
import type { ApprovalRequest } from "@rahandaz/core";
import { faNum, faText, KIND_FA, toman } from "@/lib/fa";
import { postJson } from "@/lib/use-console";
import { useTechView } from "@/lib/view";
import { CallsList, DiffView } from "./code";
import { Fa } from "./fa";
import { Badge, Button, Card } from "./ui";

export function ApprovalCard({ approval, resolved }: { approval: ApprovalRequest; resolved?: "approved" | "denied" | null }) {
  const [tech] = useTechView();
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [confirmText, setConfirmText] = useState("");
  const [budgetOverride, setBudgetOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const decision = pending && (
    <div className="space-y-2.5">
      {approval.secretInputs.map((s) => (
        <label key={s.key} className="block">
          <span className="mb-1 block text-xs">
            {tech ? (
              <>
                مقدار <code className="font-mono font-semibold">{s.key}</code> <span className="text-muted">· {s.labelFa}</span>
              </>
            ) : (
              <>
                <span className="font-semibold">
                  مقدار <code className="font-mono">{s.key}</code> را وارد کنید
                </span>
                <span className="mt-0.5 block text-[11.5px] text-muted">اگر نمی‌دانید چیست، از سازنده‌ی پروژه بپرسید. فقط روی سرور ذخیره می‌شود و هوش مصنوعی آن را نمی‌بیند.</span>
              </>
            )}
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
          {tech ? "آگاهانه از سقف بودجه عبور می‌کنم" : "می‌دانم از سقف هزینه‌ای که تعیین شده بیشتر است"}
        </label>
      )}
      {error && <p className="text-[13px] text-bad">{error}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant={destructive ? "danger" : "primary"} onClick={() => send("approved")} disabled={busy || !ready}>
          {approval.dryRun ? "تأیید (فقط نمایش)" : tech ? (destructive ? "تأیید و اجرا" : p ? "تأیید نقشه و شروع" : "تأیید و اجرا") : p ? "بله، منتشر کن" : "بله، انجام بده"}
        </Button>
        <Button variant="secondary" onClick={() => send("denied")} disabled={busy}>
          {tech ? "رد" : "نه، فعلاً نه"}
        </Button>
      </div>
    </div>
  );

  const status = (
    <>
      {resolved === "approved" && <Badge tone="ok">تأیید شد</Badge>}
      {resolved === "denied" && <Badge tone="bad">رد شد</Badge>}
    </>
  );

  if (!tech) {
    return (
      <Card tone={destructive ? "bad" : "accent"} className="overflow-hidden">
        <div className="space-y-3 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[15px] font-extrabold leading-7 ${destructive ? "text-bad" : ""}`}>
              {p ? (p.appExists ? "نسخه‌ی جدید را منتشر کنم؟" : "سایت را روی اینترنت ببرم؟") : (plainTitle(approval) ?? <Fa text={approval.titleFa} />)}
            </span>
            {status}
          </div>

          {p && (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg bg-surface-2 px-3 py-2">
                <div className="text-[11.5px] text-muted">آدرس سایت</div>
                <div className="truncate font-mono text-[13px] font-semibold" dir="ltr">{p.url.replace(/^https?:\/\//, "")}</div>
              </div>
              <div className="rounded-lg bg-surface-2 px-3 py-2">
                <div className="text-[11.5px] text-muted">هزینه</div>
                <div className={`text-[15px] font-bold ${p.overBudget ? "text-bad" : ""}`}>
                  {toman(p.monthlyCostToman)} <span className="text-[12px] font-normal text-muted">در ماه{p.pricesVerified ? "" : "، تقریبی"}</span>
                </div>
              </div>
            </div>
          )}

          {approval.dryRun && <p className="text-[12.5px] text-info">حالت آزمایشی: فقط نشان می‌دهم چه کاری می‌کردم؛ چیزی واقعاً اجرا نمی‌شود.</p>}
          {approval.taintedWarningFa && <p className="rounded-lg border border-warn/40 bg-warn-soft p-2.5 text-[12.5px] text-warn">⚠ {approval.taintedWarningFa}</p>}

          <p className="text-[12.5px] leading-6 text-muted">
            {p ? "تا «بله» نگویید هیچ چیزی ساخته نمی‌شود و هزینه‌ای ندارد." : "فقط همین یک کار انجام می‌شود."}
            {approval.undoFa && (
              <>
                {" "}اگر پشیمان شدید: <Fa text={approval.undoFa} />
              </>
            )}
          </p>

          {decision}

          <details className="rounded-lg border border-line text-[12.5px]">
            <summary className="cursor-pointer select-none px-3 py-1.5 text-muted">جزئیات فنی (برای برنامه‌نویس‌ها)</summary>
            <div className="border-t border-line p-3">
              <TechDetails approval={approval} />
            </div>
          </details>
        </div>
      </Card>
    );
  }

  return (
    <Card tone={destructive ? "bad" : "accent"} className="overflow-hidden">
      <div className={`flex flex-wrap items-center gap-2 border-b px-4 py-2.5 ${destructive ? "border-bad/30 bg-bad-soft" : "border-accent/25 bg-accent-soft"}`}>
        <span className={`text-sm font-bold ${destructive ? "text-bad" : "text-accent"}`}>{destructive ? "تأیید عملیات حساس" : p ? "نقشه‌ی استقرار" : "درخواست تأیید"}</span>
        <Badge tone={destructive ? "bad" : "accent"}>{KIND_FA[approval.kind]}</Badge>
        {approval.dryRun && <Badge tone="info">DRY_RUN: چیزی اجرا نمی‌شود</Badge>}
        {status}
      </div>

      <div className="space-y-3 p-4 text-sm">
        <p className="font-semibold leading-7"><Fa text={approval.titleFa} /></p>
        <TechDetails approval={approval} />
        {approval.taintedWarningFa && <p className="rounded-lg border border-warn/40 bg-warn-soft p-2.5 text-[12.5px] text-warn">⚠ {approval.taintedWarningFa}</p>}
        {decision}
      </div>
    </Card>
  );
}

/** The question a non-engineer is actually being asked; null → the tool's own title (e.g. a resize with its cost). */
function plainTitle(a: ApprovalRequest): string | null {
  switch (a.tool) {
    case "set_env_vars":
      return a.secretInputs.length ? "سایت یک تنظیم از شما لازم دارد" : "تنظیمات سایت را درست کنم؟";
    case "apply_fix":
      return "این اصلاح کوچک را در پروژه انجام بدهم؟";
    case "deploy_app":
      return "سایت را دوباره بسازم و منتشر کنم؟";
    case "restart_app":
      return "سایت را یک بار خاموش و روشن کنم؟";
    default:
      return null;
  }
}

/** Everything an engineer wants to review: plan specs, env names, diffs, exact API calls, risk, undo. */
function TechDetails({ approval }: { approval: ApprovalRequest }) {
  const [showCalls, setShowCalls] = useState(false);
  const p = approval.plan;
  const destructive = approval.kind === "destructive";
  return (
    <div className="space-y-3 text-sm">
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
                <li key={i}>⚠ <Fa text={w.messageFa} /></li>
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
                <li key={i}><Fa text={a.titleFa} /></li>
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

      <div className="space-y-1 rounded-lg bg-surface-2 p-2.5 text-[12.5px]">
        <div>
          <span className="text-muted">سطح ریسک: </span>
          <span className={`font-semibold ${destructive ? "text-bad" : "text-accent"}`}>
            {destructive ? "حساس؛ با تایپ نام منبع تأیید می‌شود" : approval.kind === "plan" ? "متوسط؛ تا تأیید نکنید چیزی ساخته یا تغییر نمی‌کند" : "متوسط؛ فقط همین اقدام دقیق با تأیید شما اجرا می‌شود"}
          </span>
        </div>
        {approval.undoFa && (
          <div>
            <span className="text-muted">راه برگشت: </span>
            <Fa text={approval.undoFa} />
          </div>
        )}
      </div>
    </div>
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
