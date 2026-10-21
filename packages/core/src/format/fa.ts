/** Persian formatting helpers for user-facing copy. */

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function faDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => FA_DIGITS[Number(d)]!);
}

/** 1250000 → «۱٬۲۵۰٬۰۰۰ تومان» */
export function toman(amount: number): string {
  return `${faDigits(Math.round(amount).toLocaleString("en-US").replace(/,/g, "٬"))} تومان`;
}

export function faDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${faDigits(s)} ثانیه`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${faDigits(m)} دقیقه و ${faDigits(rest)} ثانیه` : `${faDigits(m)} دقیقه`;
}
