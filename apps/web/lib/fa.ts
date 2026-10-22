/** Client-side Persian formatting (no server imports here). */

const FA = "۰۱۲۳۴۵۶۷۸۹";

export function faNum(n: number | string): string {
  return String(n).replace(/\d/g, (d) => FA[Number(d)]!);
}

/**
 * Persian digits inside Persian prose, but never inside identifiers, URLs,
 * code (`rel_0004`, `:8080`, `node:20`). Decimals use the Persian separator.
 */
export function faText(s: string): string {
  return s.replace(/(^|[^A-Za-z0-9_./:@#=+-])(\d+(?:\.\d+)?)(?![A-Za-z0-9_/:@-]|\.\w)/g, (_m, pre: string, num: string) => pre + faNum(num).replace(".", "٫"));
}

export function toman(amount: number): string {
  return `${faNum(Math.round(amount).toLocaleString("en-US").replace(/,/g, "٬"))} تومان`;
}

export function faDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${faNum(s)} ثانیه`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${faNum(m)} دقیقه و ${faNum(s % 60)} ثانیه` : `${faNum(m)} دقیقه`;
}

export function faTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

/** Risk tiers as the user sees them: what runs by itself, what waits for a yes, what needs a second yes. */
export const KIND_FA: Record<string, string> = {
  read: "خودکار · بی‌خطر",
  mutating: "نیازمند تأیید",
  destructive: "حساس · تأیید دوم",
  plan: "نیازمند تأیید",
};

export const STATUS_FA: Record<string, string> = {
  running: "در حال کار",
  awaiting_approval: "منتظر تأیید شما",
  completed: "تمام شد",
  failed: "ناموفق",
  stopped: "متوقف شد",
};

export const OUTCOME_FA: Record<string, string> = {
  healthy: "سایت روشن و سالم است",
  failed: "کار به نتیجه نرسید",
  dry_run: "اجرای آزمایشی (DRY_RUN)",
  answered: "انجام شد",
  waiting_user: "منتظر یک قدم از طرف شما",
  stopped: "متوقف شد",
};
