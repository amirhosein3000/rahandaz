// Vendored from LiaraYar (https://github.com/amirhosein3000/liarayar) @ a37aacf, src/lib/hybrid.ts.
// Changes: import paths, plus `!` for noUncheckedIndexedAccess. Keep in sync by re-copying, not by editing.
/**
 * Hybrid retrieval: BM25 + dense, fused with Reciprocal Rank Fusion.
 *
 * Why RRF rather than a weighted score blend: BM25 scores and cosine
 * similarities live on incompatible scales (BM25 is unbounded and corpus
 * dependent, cosine is [-1,1]), so any fixed blend weight is really a hidden
 * per-corpus constant. RRF only reads *ranks*, so it needs no normalization
 * and no tuning — and it is what actually fixed the failure mode this exists
 * for: exact identifiers (`ECONNRESET`, `liara.json`) that dense retrieval
 * dilutes and BM25 nails, versus paraphrased Persian questions that BM25
 * misses entirely and dense handles.
 *
 * `K` is the standard RRF damping constant. At 60, rank 1 contributes 1/61 and
 * rank 10 contributes 1/70 — a deliberately flat curve, so a document both
 * retrievers rank *moderately* well beats one that a single retriever loves.
 * That is the property we want: agreement across two different notions of
 * relevance is a stronger signal than one strong opinion.
 */
import type { RetrievedChunk } from "./chunk-type";

const RRF_K = 60;

export type FusedChunk = RetrievedChunk & {
  /** Fused RRF score. Not comparable to BM25 or cosine scores. */
  rrf: number;
  /** 1-based rank in each list, or null when that retriever did not return it. */
  bm25Rank: number | null;
  denseRank: number | null;
};

/**
 * Fuses two ranked lists. Documents are identified by `id`, so a chunk found
 * by both retrievers is credited once with the sum of its two contributions.
 */
export function fuseRRF(
  bm25: RetrievedChunk[],
  dense: RetrievedChunk[],
  k: number,
): FusedChunk[] {
  const byId = new Map<string, FusedChunk>();

  const absorb = (list: RetrievedChunk[], which: "bm25Rank" | "denseRank") => {
    list.forEach((chunk, i) => {
      const rank = i + 1;
      const existing = byId.get(chunk.id);
      if (existing) {
        existing[which] = rank;
        existing.rrf += 1 / (RRF_K + rank);
      } else {
        byId.set(chunk.id, {
          ...chunk,
          rrf: 1 / (RRF_K + rank),
          bm25Rank: which === "bm25Rank" ? rank : null,
          denseRank: which === "denseRank" ? rank : null,
        });
      }
    });
  };

  absorb(bm25, "bm25Rank");
  absorb(dense, "denseRank");

  return [...byId.values()].sort((a, b) => b.rrf - a.rrf).slice(0, k);
}

/**
 * Platform boost. A reader who has told us they run Next.js should not get the
 * Laravel page for a question that exists for both platforms.
 *
 * Applied *after* fusion and deliberately small: it reorders within the fused
 * set, it does not pull in documents the retrievers did not already surface.
 * A boost large enough to override retrieval would turn a wrong profile into
 * wrong answers, which is worse than no personalization at all.
 */
export function applyPlatformBoost(chunks: FusedChunk[], platform: string | null): FusedChunk[] {
  if (!platform) return chunks;
  const p = platform.toLowerCase();
  return [...chunks]
    .map((c) => {
      const cp = (c.platform ?? "").toLowerCase();
      // Only boost an exact platform match; never penalize platform-neutral
      // pages, which are usually the general reference the answer needs.
      const boost = cp && cp === p ? 1.15 : 1;
      return { ...c, rrf: c.rrf * boost };
    })
    .sort((a, b) => b.rrf - a.rrf);
}

/**
 * Retrieval confidence in [0,1], used against REFUSAL_THRESHOLD.
 *
 * Derived from agreement and depth rather than raw score: the top result's
 * rank in each list, and how many of the top results both retrievers found.
 * A question the docs genuinely answer tends to produce a document that both
 * retrievers rank highly; a question they do not tends to produce two
 * unrelated lists whose top items neither agrees on.
 */
export function retrievalConfidence(fused: FusedChunk[], denseAvailable = true): number {
  if (fused.length === 0) return 0;
  const top = fused[0]!;

  // Best possible: rank 1 in both lists.
  const bestRank = Math.min(top.bm25Rank ?? 99, top.denseRank ?? 99);
  const rankScore = 1 / (1 + Math.log2(bestRank));

  // With only one retriever running there is nothing to agree *with*, so the
  // agreement term would be a fixed 0 and drag every question under the
  // refusal threshold — the app would refuse everything rather than answer
  // from keywords. Fall back to rank alone in that mode.
  if (!denseAvailable) return Math.max(0, Math.min(1, rankScore));

  // Agreement across the top 5: both retrievers surfaced the same document.
  const head = fused.slice(0, 5);
  const agreed = head.filter((c) => c.bm25Rank !== null && c.denseRank !== null).length;
  const agreementScore = head.length > 0 ? agreed / head.length : 0;

  // Weighted toward rank: one unambiguous hit is a stronger signal than
  // broad mediocre overlap.
  const raw = 0.65 * rankScore + 0.35 * agreementScore;
  return Math.max(0, Math.min(1, raw));
}
