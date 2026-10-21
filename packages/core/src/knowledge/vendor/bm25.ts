// Vendored from LiaraYar (https://github.com/amirhosein3000/liarayar) @ a37aacf, src/lib/bm25.ts.
// Changes: import paths, plus `!` for noUncheckedIndexedAccess. Keep in sync by re-copying, not by editing.
/**
 * Okapi BM25 over the chunk corpus. Pure computation — no credentials, no
 * network — which is why it's the retrieval path that works from session
 * one (see `docs/DECISIONS.md` §"Retrieval index (P1 session)"). Dense
 * vectors (`src/lib/retriever.ts`) slot in beside this, never replace it.
 */
import { tokenizeFa } from "./normalize";
import type { DocChunk } from "./chunk-type";

const K1 = 1.5;
const B = 0.75;

export type BM25Index = {
  /** token -> (docIndex -> term frequency in that doc) */
  postings: Map<string, Map<number, number>>;
  docLengths: number[];
  avgDocLength: number;
  N: number;
  idf: Map<string, number>;
};

/**
 * The text actually indexed: `{title} › {breadcrumb} › {heading path}` on
 * its own line, then the chunk body. Persian headings carry most of a doc
 * chunk's intent signal, and prefixing it gives BM25 those terms too — not
 * stored as a separate field, just recomputed here and at query build time.
 */
export function enrichedIndexText(chunk: Pick<DocChunk, "title" | "breadcrumb" | "headingPath" | "text">): string {
  const headingPart = chunk.headingPath.join(" › ");
  const prefix = [chunk.title, chunk.breadcrumb, headingPart].filter(Boolean).join(" › ");
  return `${prefix}\n\n${chunk.text}`;
}

export function buildBM25Index(chunks: DocChunk[]): BM25Index {
  const postings = new Map<string, Map<number, number>>();
  const docLengths = new Array<number>(chunks.length);
  const df = new Map<string, number>();

  chunks.forEach((chunk, docIndex) => {
    const tokens = tokenizeFa(enrichedIndexText(chunk));
    docLengths[docIndex] = tokens.length;

    const termFreq = new Map<string, number>();
    for (const tok of tokens) termFreq.set(tok, (termFreq.get(tok) ?? 0) + 1);

    for (const [tok, tf] of termFreq) {
      let postingList = postings.get(tok);
      if (!postingList) {
        postingList = new Map();
        postings.set(tok, postingList);
      }
      postingList.set(docIndex, tf);
      df.set(tok, (df.get(tok) ?? 0) + 1);
    }
  });

  const N = chunks.length;
  const avgDocLength = N > 0 ? docLengths.reduce((s, l) => s + l, 0) / N : 0;

  const idf = new Map<string, number>();
  for (const [tok, freq] of df) {
    // Standard BM25 idf; the +1 keeps it non-negative even for very common terms.
    idf.set(tok, Math.log(1 + (N - freq + 0.5) / (freq + 0.5)));
  }

  return { postings, docLengths, avgDocLength, N, idf };
}

/**
 * The docs only ever spell platform/framework names in Latin script
 * (breadcrumbs, titles, code) — a merchant typing the common Persian
 * phonetic spelling ("نکست" for "Next.js") gets zero token overlap with
 * "nextjs" no matter how the corpus is tokenized. Small, explicit, and a
 * deliberate stopgap — same pattern and same caveat as the synonym map in
 * `src/app/ops/clustering.ts`. Dense search (once built) needs no such map;
 * this only ever expands the query side, never the index.
 */
const QUERY_SYNONYMS: Record<string, string[]> = {
  "نکست": ["nextjs", "next"],
  "جنگو": ["django"],
  "لاراول": ["laravel"],
  "پایتون": ["python"],
  "جاوااسکریپت": ["javascript", "js"],
  "داکر": ["docker"],
  "ردیس": ["redis"],
  "پستگرس": ["postgresql", "postgres"],
  "ریاکت": ["react"],
  "آنگیولار": ["angular"],
  "وردپرس": ["wordpress"],
};

function expandQueryTokens(tokens: string[]): string[] {
  const expanded = [...tokens];
  for (const tok of tokens) {
    const synonyms = QUERY_SYNONYMS[tok];
    if (synonyms) expanded.push(...synonyms);
  }
  return expanded;
}

export function bm25Search(index: BM25Index, query: string, k: number): Array<{ docIndex: number; score: number }> {
  const queryTokens = expandQueryTokens(tokenizeFa(query));
  if (queryTokens.length === 0 || index.N === 0) return [];

  const scores = new Map<number, number>();
  const seenQueryTokens = new Set(queryTokens);

  for (const tok of seenQueryTokens) {
    const postingList = index.postings.get(tok);
    const idf = index.idf.get(tok);
    if (!postingList || idf === undefined) continue;
    for (const [docIndex, tf] of postingList) {
      const docLen = index.docLengths[docIndex]!;
      const denom = tf + K1 * (1 - B + (B * docLen) / (index.avgDocLength || 1));
      scores.set(docIndex, (scores.get(docIndex) ?? 0) + idf * ((tf * (K1 + 1)) / denom));
    }
  }

  return Array.from(scores, ([docIndex, score]) => ({ docIndex, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
