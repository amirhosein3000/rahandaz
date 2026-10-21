"use client";
import { useEffect, useState } from "react";
import type { AuditEntry } from "@rahandaz/core";
import { Header } from "@/components/header";
import { Badge, Card } from "@/components/ui";
import { faNum, faText } from "@/lib/fa";
import type { ConsoleState } from "@/lib/use-console";

const RESULT_TONE: Record<string, "ok" | "bad" | "warn" | "info" | "neutral" | "accent"> = {
  ok: "ok",
  approved: "ok",
  error: "bad",
  denied: "bad",
  blocked: "bad",
  requested: "accent",
  dry_run: "info",
  info: "neutral",
};

export default function AuditPage() {
  const [data, setData] = useState<{ entries: AuditEntry[]; verify: { ok: boolean; brokenAt: number | null; count: number } } | null>(null);
  const [state, setState] = useState<ConsoleState | null>(null);
  const [filter, setFilter] = useState<"all" | "changes">("changes");

  useEffect(() => {
    const load = () => {
      void fetch("/api/audit", { cache: "no-store" }).then(async (r) => r.ok && setData(await r.json()));
      void fetch("/api/state", { cache: "no-store" }).then(async (r) => r.ok && setState(await r.json()));
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const entries = (data?.entries ?? []).filter((e) => filter === "all" || e.kind === "mutating" || e.kind === "destructive" || e.kind === "plan" || e.action === "chaos_break" || e.action === "injection_detected");

  return (
    <div className="min-h-dvh">
      <Header state={state} active="audit" />
      <main className="mx-auto max-w-[1200px] space-y-4 px-4 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-extrabold">گزارش ممیزی</h1>
          {data && (
            <Badge tone={data.verify.ok ? "ok" : "bad"}>
              {data.verify.ok ? `زنجیره‌ی هش سالم · ${faNum(data.verify.count)} رکورد` : `دست‌کاری در رکورد #${faNum(data.verify.brokenAt ?? 0)}`}
            </Badge>
          )}
          <div className="ms-auto flex gap-1 rounded-lg bg-surface-2 p-1 text-[13px]">
            <button className={`rounded-md px-2.5 py-1 ${filter === "changes" ? "bg-surface font-semibold" : "text-muted"}`} onClick={() => setFilter("changes")}>
              تغییرات و تأییدها
            </button>
            <button className={`rounded-md px-2.5 py-1 ${filter === "all" ? "bg-surface font-semibold" : "text-muted"}`} onClick={() => setFilter("all")}>
              همه
            </button>
          </div>
        </div>
        <p className="text-[13px] text-muted">هر اقدام (چه کسی، چه کاری، چه زمانی، چه نتیجه‌ای) فقط اضافه می‌شود و هر رکورد هش رکورد قبلی را دارد؛ هر ویرایش یا حذف، زنجیره را می‌شکند. مقدار رمزها هیچ‌وقت ثبت نمی‌شود.</p>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="border-b border-line bg-surface-2 text-[12px] text-muted">
              <tr>
                <th className="px-3 py-2 text-start font-medium">#</th>
                <th className="px-3 py-2 text-start font-medium">زمان</th>
                <th className="px-3 py-2 text-start font-medium">چه کسی</th>
                <th className="px-3 py-2 text-start font-medium">چه کاری</th>
                <th className="px-3 py-2 text-start font-medium">منبع</th>
                <th className="px-3 py-2 text-start font-medium">نتیجه</th>
                <th className="px-3 py-2 text-start font-medium">جزئیات</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.seq} className="border-b border-line/70 align-top last:border-0">
                  <td className="px-3 py-2 text-muted">{faNum(e.seq)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted">{new Date(e.ts).toLocaleString("fa-IR")}</td>
                  <td className="px-3 py-2 font-mono text-[12px]" dir="ltr">{e.actor}</td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-[12px]">{e.tool ?? e.action}</span>
                    {e.kind && <span className="ms-1.5 text-[11px] text-muted">({e.kind})</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px]">{e.resource ?? ""}</td>
                  <td className="px-3 py-2"><Badge tone={RESULT_TONE[e.result] ?? "neutral"}>{e.result}</Badge></td>
                  <td className="max-w-[320px] px-3 py-2 text-[12px] break-words text-muted">{e.detail ? faText(e.detail) : ""}</td>
                </tr>
              ))}
              {!entries.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted">هنوز رکوردی نیست.</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </main>
    </div>
  );
}
