"use client";
import { faText } from "@/lib/fa";

/**
 * Persian text with Persian digits, where every Latin run (URLs, file names,
 * env vars, identifiers) is bidi-isolated so it keeps its own direction and
 * punctuation stays on the right side in RTL.
 */
export function Fa({ text, className }: { text: string; className?: string }) {
  const parts = faText(text).split(/((?:https?:\/\/)?[A-Za-z_][\w.\-/:@=?&%#+]*[\w/])/g);
  return (
    <span className={className}>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <bdi key={i} dir="ltr" className={p.length <= 30 ? "whitespace-nowrap" : "break-all"}>
            {p}
          </bdi>
        ) : (
          p
        ),
      )}
    </span>
  );
}
