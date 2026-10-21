"use client";
import { useEffect, useRef, useState } from "react";

export function LogBlock({ lines, title, max = 400 }: { lines: string[]; title: string; max?: number }) {
  const [open, setOpen] = useState(true);
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (open && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length, open]);
  const shown = lines.slice(-max);
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between bg-surface-2 px-3 py-1.5 text-xs text-muted hover:text-ink"
        aria-expanded={open}
      >
        <span>{title}</span>
        <span>{open ? "بستن" : "نمایش"}</span>
      </button>
      {open && (
        <pre ref={ref} className="scroll-thin max-h-64 overflow-auto bg-code-bg px-3 py-2 font-mono text-[12px] leading-5 text-code-ink">
          {shown.map((l, i) => (
            <div key={i} className={`whitespace-pre-wrap break-all ${/error|failed|refused|denied|traceback|unhealthy|not found/i.test(l) ? "text-[#ff8a80]" : /successfully|ready|listening/i.test(l) ? "text-[#7ee2b8]" : ""}`}>
              {l}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

export function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="scroll-thin overflow-auto rounded-lg border border-line bg-code-bg px-0 py-2 font-mono text-[12px] leading-5 text-code-ink">
      {diff.split("\n").map((l, i) => {
        const cls = l.startsWith("+++") || l.startsWith("---") ? "text-[#9aa3ad]" : l.startsWith("+") ? "bg-[#12361f] text-[#8ff0b5]" : l.startsWith("-") ? "bg-[#3d1717] text-[#ffaaa3]" : l.startsWith("@@") ? "text-[#7fb4ff]" : "";
        return (
          <div key={i} className={`px-3 whitespace-pre ${cls}`}>
            {l || " "}
          </div>
        );
      })}
    </pre>
  );
}

export function CallsList({ calls }: { calls: Array<{ method: string; path: string; body?: unknown; note?: string }> }) {
  if (!calls.length) return null;
  return (
    <ul className="space-y-1 rounded-lg border border-line bg-surface-2 p-2 font-mono text-[11.5px]" dir="ltr">
      {calls.map((c, i) => (
        <li key={i} className="break-all">
          <span className={c.method === "DELETE" ? "font-bold text-bad" : c.method === "GET" ? "text-info" : "font-bold text-accent"}>{c.method}</span> <span className="text-ink">{c.path}</span>
          {c.body !== undefined && <span className="text-muted"> {JSON.stringify(c.body)}</span>}
          {c.note && <span className="text-muted"> · {c.note}</span>}
        </li>
      ))}
    </ul>
  );
}
