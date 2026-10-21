"use client";
import type { ReactNode } from "react";

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-ink" />
      <path d="M7 25c6 0 7-9 13-9h3" fill="none" className="stroke-accent" strokeWidth="3" strokeLinecap="round" />
      <path d="M20 11.5l5 4.5-5 4.5" fill="none" className="stroke-accent" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="25" r="2" className="fill-bg" />
    </svg>
  );
}

type Tone = "neutral" | "accent" | "ok" | "bad" | "warn" | "info";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-line",
  accent: "bg-accent-soft text-accent border-accent/30",
  ok: "bg-ok-soft text-ok border-ok/30",
  bad: "bg-bad-soft text-bad border-bad/30",
  warn: "bg-warn-soft text-warn border-warn/30",
  info: "bg-info-soft text-info border-info/30",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Dot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  const color = { neutral: "bg-muted", accent: "bg-accent", ok: "bg-ok", bad: "bg-bad", warn: "bg-warn", info: "bg-info" }[tone];
  return <span className={`inline-block size-2 shrink-0 rounded-full ${color} ${pulse ? "pulse-dot" : ""}`} aria-hidden="true" />;
}

export function Card({ children, className = "", tone }: { children: ReactNode; className?: string; tone?: Tone }) {
  const border = tone ? { neutral: "border-line", accent: "border-accent/50", ok: "border-ok/40", bad: "border-bad/40", warn: "border-warn/50", info: "border-info/40" }[tone] : "border-line";
  return <div className={`rounded-xl border bg-surface shadow-card ${border} ${className}`}>{children}</div>;
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  const styles = {
    primary: "bg-accent text-on-accent hover:brightness-105 border-transparent",
    secondary: "bg-surface text-ink border-line hover:bg-surface-2",
    danger: "bg-bad text-white border-transparent hover:brightness-105",
    ghost: "bg-transparent text-muted border-transparent hover:bg-surface-2 hover:text-ink",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-3.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Spinner() {
  return <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent motion-reduce:animate-none" aria-label="در حال انجام" />;
}
