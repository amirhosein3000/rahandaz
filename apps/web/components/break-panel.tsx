"use client";
import { useEffect, useMemo, useState } from "react";
import { faDuration, faNum } from "@/lib/fa";
import { postJson, type ConsoleState, type RunView } from "@/lib/use-console";
import { Badge, Button, Card, Dot } from "./ui";

/** «خرابش کن»: the judge breaks a healthy app; the timer runs until the agent has it healthy again. */
export function BreakPanel({ state, runs }: { state: ConsoleState | null; runs: RunView[] }) {
  const target = state?.apps.find((a) => a.name === "demo-shop") ?? state?.apps[0];
  const [scenario, setScenario] = useState<"missing_env" | "wrong_port" | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brokenAt, setBrokenAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const recoveredAt = useMemo(() => {
    if (!brokenAt || !target) return null;
    for (const r of runs)
      for (const e of r.events)
        if (e.type === "health" && e.app === target.name && e.health.ok && Date.parse(e.ts) > brokenAt) return Date.parse(e.ts);
    return null;
  }, [runs, brokenAt, target]);

  useEffect(() => {
    if (!brokenAt || recoveredAt) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [brokenAt, recoveredAt]);

  if (!state || !target) return null;
  const healthy = target.health?.ok ?? false;

  const doBreak = async () => {
    if (!scenario) return;
    setBusy(true);
    setError(null);
    const res = await postJson("/api/chaos", { app: target.name, scenario, confirmText: confirm });
    setBusy(false);
    if (!res.ok) return setError(res.errorFa ?? "خطا");
    setBrokenAt(Date.parse(String(res.at)) || Date.now());
    setNow(Date.now());
    setScenario(null);
    setConfirm("");
  };

  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">صحنه‌ی «خرابش کن»</span>
        <Dot tone={healthy ? "ok" : "bad"} pulse={!healthy} />
        <code className="font-mono text-[12.5px]">{target.name}</code>
        <Badge tone={healthy ? "ok" : "bad"}>{healthy ? "سالم" : `ناسالم${target.health?.status ? ` · ${faNum(target.health.status)}` : ""}`}</Badge>
        {brokenAt && (
          <span className={`ms-auto text-[12.5px] font-semibold ${recoveredAt ? "text-ok" : "text-bad"}`}>
            {recoveredAt ? `برگشت به سلامت در ${faDuration(recoveredAt - brokenAt)}` : `خراب از ${faDuration(now - brokenAt)} پیش`}
          </span>
        )}
      </div>

      {!state.modes.allowDestructive ? (
        <p className="mt-2 text-[12px] text-muted">این صحنه یک تغییر حساس است و فقط با ALLOW_DESTRUCTIVE=true فعال می‌شود.</p>
      ) : scenario ? (
        <div className="mt-2.5 space-y-2">
          <p className="text-[12.5px] text-bad">{state.chaos.find((c) => c.id === scenario)?.descriptionFa} برای تأیید، نام اپ را تایپ کنید:</p>
          <div className="flex gap-2">
            <input
              dir="ltr"
              autoFocus
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-bad/50 bg-surface px-3 py-1.5 font-mono text-sm outline-none focus:border-bad"
              placeholder={target.name}
              aria-label="نام اپ برای تأیید"
            />
            <Button variant="danger" onClick={doBreak} disabled={busy || confirm.trim() !== target.name}>
              خرابش کن
            </Button>
            <Button variant="ghost" onClick={() => setScenario(null)}>
              انصراف
            </Button>
          </div>
          {error && <p className="text-[12.5px] text-bad">{error}</p>}
        </div>
      ) : (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {state.chaos.map((c) => (
            <Button key={c.id} variant="secondary" onClick={() => setScenario(c.id)} disabled={!healthy}>
              {c.titleFa}
            </Button>
          ))}
          <span className="self-center text-[11.5px] text-muted">نگهبان سلامت خرابی را خودش می‌بیند و ایجنت را راه می‌اندازد.</span>
        </div>
      )}
    </Card>
  );
}
