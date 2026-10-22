"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ConsoleState } from "@/lib/use-console";
import { useTechView } from "@/lib/view";
import { Badge, Logo } from "./ui";

export function Header({ state, connected, active }: { state: ConsoleState | null; connected?: boolean; active: "console" | "audit" }) {
  const m = state?.modes;
  const [tech, setTech] = useTechView();
  // Pages other than the console are technical by nature: always show their navigation.
  const showTech = tech || active !== "console";
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2 sm:px-4 sm:py-2.5">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo />
          <div className="leading-tight">
            <div className="text-[17px] font-extrabold">راه‌انداز</div>
            <div className="hidden text-[11px] text-muted sm:block">دستیار انتشار سایت روی لیارا · ساخته‌شده برای هکاتون لیارا</div>
          </div>
        </Link>
        {!showTech && (
          <div className="ms-auto flex items-center gap-1.5">
            {m && m.liara !== "real" && <Badge tone="neutral" title="LIARA_MODE=mock">نسخه‌ی نمایشی</Badge>}
            <ViewToggle tech={tech} onChange={setTech} />
            <ThemeToggle />
          </div>
        )}
        {showTech && (
        <>
        <nav className="flex items-center gap-1 text-[13px]">
          <Link href="/" className={`rounded-md px-2.5 py-1 ${active === "console" ? "bg-surface-2 font-semibold" : "text-muted hover:text-ink"}`}>
            کنسول
          </Link>
          <Link href="/audit" className={`rounded-md px-2.5 py-1 ${active === "audit" ? "bg-surface-2 font-semibold" : "text-muted hover:text-ink"}`}>
            گزارش ممیزی
          </Link>
          <Link href="/limits" className="rounded-md px-2.5 py-1 text-muted hover:text-ink">
            قابلیت‌ها
          </Link>
        </nav>
        <div className="scroll-thin order-last flex w-full items-center gap-1.5 overflow-x-auto sm:order-none sm:ms-auto sm:w-auto sm:flex-wrap sm:overflow-visible">
          {m && (
            <>
              <Badge tone={m.liara === "real" ? "accent" : "neutral"} title="LIARA_MODE">{m.liara === "real" ? "لیارای واقعی" : "لیارای شبیه‌سازی"}</Badge>
              <Badge tone="neutral" title="LLM">{m.llm.startsWith("mock") ? "مدل: شبیه‌سازی" : m.llm.replace("openai-compatible:", "")}</Badge>
              {m.dryRun && <Badge tone="info" title="DRY_RUN">اجرای آزمایشی</Badge>}
              <Badge tone={m.allowDestructive ? "bad" : "ok"} title="ALLOW_DESTRUCTIVE">{m.allowDestructive ? "عملیات حساس: فعال" : "عملیات حساس: خاموش"}</Badge>
            </>
          )}
          {connected !== undefined && <span className={`size-2 rounded-full ${connected ? "bg-ok" : "bg-bad"}`} title={connected ? "متصل" : "قطع"} />}
          {active === "console" && <ViewToggle tech={tech} onChange={setTech} />}
          <ThemeToggle />
        </div>
        </>
        )}
      </div>
    </header>
  );
}

function ViewToggle({ tech, onChange }: { tech: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={tech}
      onClick={() => onChange(!tech)}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-ink"
      title="نمایش جزئیات فنی برای برنامه‌نویس‌ها"
    >
      <span className={`relative h-4 w-7 rounded-full transition ${tech ? "bg-accent" : "bg-line"}`} aria-hidden="true">
        <span className={`absolute top-0.5 size-3 rounded-full bg-surface shadow transition-all ${tech ? "start-3.5" : "start-0.5"}`} />
      </span>
      نمای فنی
    </button>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<string | null>(null);
  useEffect(() => setTheme(document.documentElement.dataset.theme ?? null), []);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="rounded-md px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-ink"
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("rz-theme", next);
        } catch {
          // storage unavailable: theme still applies for this page
        }
        setTheme(next);
      }}
      aria-label="تغییر پوسته"
    >
      {theme === "dark" ? "روشن" : "تیره"}
    </button>
  );
}
