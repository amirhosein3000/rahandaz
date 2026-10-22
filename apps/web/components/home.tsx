"use client";
import { useRef, useState } from "react";
import { faNum, friendlyTitle } from "@/lib/fa";
import { postJson, type ConsoleState, type RunView } from "@/lib/use-console";
import { useTechView } from "@/lib/view";
import { BreakPanel } from "./break-panel";
import { Button, Card, Dot } from "./ui";

/**
 * Landing for someone who knows nothing about deployment: one input, three
 * intents in plain words, and their apps with a one-click health check.
 */
export function Home({ state, runs, onOpen }: { state: ConsoleState | null; runs: RunView[]; onOpen: (id: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const start = async (message: string) => {
    if (!message.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await postJson("/api/runs", { message });
    setBusy(false);
    if (!res.ok) setError(res.errorFa ?? "خطا");
    else setText("");
  };
  const focusWith = (prefill: string) => {
    setText(prefill);
    input.current?.focus();
  };

  const apps = state?.apps ?? [];
  const samples = state?.fixtures.filter((f) => f.failure) ?? [];
  const hero = samples.find((f) => f.hero) ?? samples[0];
  const [tech] = useTechView();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-3 py-6 sm:px-4 sm:py-10">
      <section className="space-y-3 text-center">
        <h1 className="text-2xl font-extrabold leading-tight sm:text-3xl">سایتت را بده؛ بقیه‌اش با «راهی».</h1>
        <p className="mx-auto max-w-2xl text-[14px] leading-7 text-muted">
          لینک پروژه را بدهید تا روی لیارا منتشرش کنم. اگر سایت کند شد یا خطا داد، علتش را پیدا می‌کنم و به زبان ساده می‌گویم. هیچ کاری بدون «بله»ی شما انجام نمی‌شود.
        </p>
      </section>

      <form
        className="rounded-2xl border border-line bg-surface p-3 shadow-card"
        onSubmit={(e) => {
          e.preventDefault();
          void start(text);
        }}
      >
        <textarea
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void start(text);
            }
          }}
          rows={2}
          placeholder="لینک گیت‌هاب پروژه را بگذارید، یا بنویسید چه مشکلی دارید؛ مثلاً «سایتم کند شده»"
          className="w-full resize-none bg-transparent px-2 py-1.5 text-[15px] leading-7 outline-none placeholder:text-muted"
          aria-label="درخواست شما"
        />
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-[12px] text-muted">مثل پیام دادن به یک همکار بنویسید.</span>
          <Button type="submit" disabled={busy || !text.trim()}>
            {busy ? "در حال شروع…" : "شروع"}
          </Button>
        </div>
        {error && <p className="px-1 pt-1 text-[13px] text-bad">{error}</p>}
      </form>

      {hero && (
        <p className="-mt-3 text-center text-[13px] text-muted">
          پروژه‌ای ندارید؟{" "}
          <button type="button" disabled={busy} onClick={() => void start(`این پروژه را منتشر کن: https://github.com/rahandaz-demo/${hero.name}`)} className="font-semibold text-accent underline-offset-4 hover:underline">
            با یک سایت نمونه امتحان کنید ←
          </button>
        </p>
      )}

      <section className="grid gap-2 sm:grid-cols-3 sm:gap-3">
        <Intent
          icon="🚀"
          title="سایتم را منتشر کن"
          body="لینک گیت‌هاب پروژه را بدهید؛ هزینه را می‌گویم و بعد از تأیید شما سایت را روشن می‌کنم."
          onClick={() => focusWith("این پروژه را منتشر کن: https://github.com/")}
        />
        <Intent
          icon="🩺"
          title="سایتم مشکل دارد"
          body="کند است؟ صفحه‌ی خطا نشان می‌دهد؟ بررسی می‌کنم و علت و راه‌حل را می‌گویم."
          onClick={() => (apps[0] ? void start(`سایت ${apps[0].name} مشکل دارد؛ بررسی کن چرا.`) : focusWith("سایتم کند شده؛ بررسی کن چرا."))}
        />
        <Intent icon="📦" title="تغییرات تازه را منتشر کن" body="آخرین تغییرات پروژه را روی سایت می‌برم و مطمئن می‌شوم سایت سالم بماند." onClick={() => {
          const withRepo = apps.find((a) => a.repo);
          if (withRepo) void start(`نسخه‌ی جدید ${withRepo.repo} را روی اپ ${withRepo.name} منتشر کن`);
          else focusWith("نسخه‌ی جدید https://github.com/ را منتشر کن");
        }} />
      </section>

      {apps.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[15px] font-bold">سایت‌های شما</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {apps.map((a) => {
              const ok = a.health?.ok ?? false;
              const slow = ok && (a.health?.latencyMs ?? 0) >= 2000;
              return (
                <Card key={a.name} className="p-3">
                  <div className="flex items-center gap-2">
                    <Dot tone={!ok ? "bad" : slow ? "warn" : "ok"} pulse={!ok || slow} />
                    <code className="font-mono text-[14px] font-semibold">{a.name}</code>
                                        <span className={`ms-auto text-[12px] ${!ok ? "text-bad" : slow ? "text-warn" : "text-ok"}`}>
                      {!ok ? "از دسترس خارج" : slow ? `کند (${faNum(a.health?.latencyMs ?? 0)}ms)` : "سالم"}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant={ok && !slow ? "secondary" : "primary"} onClick={() => void start(`بررسی کامل سلامت اپ ${a.name}: لاگ‌ها، منابع و خطاها`)}>
                      🩺 بررسی سلامت
                    </Button>
                    {a.repo && (
                      <Button variant="secondary" onClick={() => void start(`نسخه‌ی جدید ${a.repo} را روی اپ ${a.name} منتشر کن`)}>
                        📦 انتشار تغییرات تازه
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {state?.modes.allowDestructive && <BreakPanel state={state} runs={runs} />}

      {tech && samples.length > 0 && (
        <details className="rounded-xl border border-line bg-surface p-3 text-[13px]">
          <summary className="cursor-pointer select-none font-semibold">پروژه ندارید؟ با یک نمونه امتحان کنید</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {samples.map((f) => (
              <button
                key={f.name}
                type="button"
                onClick={() => void start(`این پروژه را منتشر کن: https://github.com/rahandaz-demo/${f.name}`)}
                className={`rounded-full border px-3 py-1.5 transition hover:border-accent hover:text-accent ${f.hero ? "border-accent/50 bg-accent-soft text-accent" : "border-line bg-surface-2"}`}
              >
                {f.titleFa}
              </button>
            ))}
          </div>
        </details>
      )}

      {runs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[15px] font-bold">کارهای اخیر</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {runs.slice(0, 6).map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => onOpen(r.id)} className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[13px] hover:bg-surface-2">
                  <Dot tone={r.status === "completed" ? "ok" : r.status === "failed" ? "bad" : "accent"} pulse={r.status === "running" || r.status === "awaiting_approval"} />
                  <span className="min-w-0 flex-1 truncate">
                    {r.trigger === "incident" ? "🚨 " : ""}
                    {friendlyTitle(r.title)}
                  </span>
                  <span className="shrink-0 text-[12px] text-muted">{r.status === "awaiting_approval" ? "منتظر تأیید" : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Intent({ icon, title, body, onClick }: { icon: string; title: string; body: string; onClick: () => void }) {
  return (
    // Phone: a compact row (icon beside the text); laptop: a card.
    <button type="button" onClick={onClick} className="group flex items-start gap-3 rounded-xl border border-line bg-surface p-3 text-start shadow-card transition hover:border-accent sm:block sm:p-4">
      <div className="text-2xl" aria-hidden="true">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[15px] font-bold group-hover:text-accent sm:mt-2">{title}</div>
        <p className="mt-0.5 text-[12.5px] leading-6 text-muted sm:mt-1">{body}</p>
      </div>
    </button>
  );
}
