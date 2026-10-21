// Vendored from LiaraYar (https://github.com/amirhosein3000/liarayar) @ a37aacf, src/lib/normalize.ts.
// Changes: import paths, plus `!` for noUncheckedIndexedAccess. Keep in sync by re-copying, not by editing.
/**
 * Persian-aware text normalization and tokenization. `normalizeFa` is used
 * for scenario keyword matching and the mock semantic-cache key in
 * `src/app/api/chat/route.ts` — keep it backward compatible (same signature,
 * same behavior for every input the mock's demo questions and
 * `scripts/mock-check.ts` exercise). `tokenizeFa` is new (P1): it feeds the
 * BM25 index in `src/lib/bm25.ts` and must keep dotted/underscored/hyphenated
 * identifiers (`liara.json`, `ECONNRESET`, `DISABLE_COLLECT_STATIC`) intact
 * as single tokens — that's the difference between BM25 working on this
 * corpus and being useless on it.
 */

const DIGIT_MAP: Record<string, string> = {
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};
const DIGIT_RE = /[۰-۹٠-٩]/g;

/**
 * Shared groundwork for both `normalizeFa` and `tokenizeFa`: canonical form,
 * strip diacritics, fold letter/digit variants, collapse ZWNJ/bidi marks to
 * spaces, lowercase. Deliberately does NOT touch punctuation like `.`/`_`/`-`
 * — `normalizeFa` strips those afterward for matching; `tokenizeFa` needs
 * them alive to keep identifiers intact.
 */
function baseNormalize(input: string): string {
  return input
    .normalize("NFKC")
    // Digit folding runs before diacritic stripping: the diacritics range
    // below (U+064B-U+0670) overlaps the Arabic-Indic digit block
    // (U+0660-U+0669), so ٠-٩ must already be plain ASCII by the time it runs.
    .replace(DIGIT_RE, (d) => DIGIT_MAP[d] ?? d) // Arabic-Indic / Persian digits -> ASCII
    .replace(/[ً-ٰٟۖ-ۭ]/g, "") // strip Arabic/Persian diacritics
    .replace(/ك/g, "ک") // Arabic ك -> Persian ک
    .replace(/ي/g, "ی") // Arabic ي -> Persian ی
    .replace(/[أإآٱ]/g, "ا") // alef variants -> ا
    .replace(/ة/g, "ه") // teh marbuta -> ه
    .replace(/[‌‎‏]/g, " ") // ZWNJ / LTR / RTL marks -> space
    .toLowerCase();
}

export function normalizeFa(input: string): string {
  return baseNormalize(input)
    .replace(/[؟!.,،؛:"'`]/g, "") // ؟ ! . , ، ؛ : " ' `
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * normalize, then split on non-alphanumeric — except `.`/`_`/`-` *between*
 * two alphanumeric runs, which stay part of the token. So `liara.json`,
 * `next.config.js`, `ECONNRESET` and `DISABLE_COLLECT_STATIC` each survive as
 * one token (case-folded, since BM25 here is case-insensitive by design).
 */
export function tokenizeFa(input: string): string[] {
  const base = baseNormalize(input);
  return base.match(/[\p{L}\p{N}]+(?:[._-][\p{L}\p{N}]+)*/gu) ?? [];
}
