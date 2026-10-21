"use client";
import { useState } from "react";
import type { CiSetup } from "@rahandaz/core";
import { Fa } from "./fa";
import { Button, Card } from "./ui";

/** Continuous deployment in two user steps: the generated workflow, ready to copy. */
export function CiCard({ setup }: { setup: CiSetup }) {
  const [copied, setCopied] = useState(false);
  return (
    <Card tone="info" className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <span className="text-[15px] font-extrabold">استقرار خودکار با هر push</span>
        <code className="font-mono text-[12.5px] text-muted">{setup.app}</code>
      </div>
      <ol className="space-y-2 p-4 text-[13px] leading-6">
        {setup.stepsFa.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-bold text-on-accent" aria-hidden="true">
              👤
            </span>
            <Fa text={s} />
          </li>
        ))}
      </ol>
      <div className="px-4 pb-4">
        <div className="mb-1 flex items-center justify-between">
          <code className="font-mono text-[12px] text-muted" dir="ltr">
            {setup.path}
          </code>
          <Button
            variant="secondary"
            onClick={() =>
              void navigator.clipboard?.writeText(setup.content).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? "کپی شد ✓" : "کپی فایل"}
          </Button>
        </div>
        <pre className="scroll-thin overflow-auto rounded-lg bg-code-bg px-3 py-2 font-mono text-[12px] leading-5 text-code-ink">{setup.content}</pre>
        <a href={setup.docsUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[12px] text-info underline-offset-4 hover:underline">
          📄 مستند CI/CD لیارا
        </a>
      </div>
    </Card>
  );
}
