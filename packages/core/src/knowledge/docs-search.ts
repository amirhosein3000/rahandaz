/**
 * `search_liara_docs`: Liara documentation retrieval, reusing LiaraYar's
 * Persian tokenizer, BM25 and RRF fusion (./vendor) over its prebuilt index
 * (data/liara-docs). BM25 always works offline; dense + RRF fusion switches on
 * when an embedding endpoint is configured.
 */
import fs from "node:fs";
import path from "node:path";
import { bm25Search, buildBM25Index, type BM25Index } from "./vendor/bm25";
import type { DocChunk, RetrievedChunk } from "./vendor/chunk-type";
import { fuseRRF } from "./vendor/hybrid";
import { tokenizeFa } from "./vendor/normalize";

export interface DocHit {
  title: string;
  url: string;
  heading: string;
  snippet: string;
  score: number;
  via: "bm25" | "hybrid";
}

export interface DocsSearch {
  search(query: string, k?: number): Promise<DocHit[]>;
  info(): { chunks: number; dense: boolean };
}

interface IndexMeta {
  count: number;
  hasDense: boolean;
  dims: number;
  embedModel: string | null;
}

export interface EmbedConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class LiaraDocsIndex implements DocsSearch {
  private chunks: DocChunk[] = [];
  private bm25: BM25Index | null = null;
  private vectors: Float32Array | null = null;
  private meta: IndexMeta | null = null;
  private loaded = false;
  private denseDisabledUntil = 0;

  constructor(
    private readonly dir: string,
    private readonly embed: EmbedConfig | null = null,
  ) {}

  private load() {
    if (this.loaded) return;
    this.loaded = true;
    const metaPath = path.join(this.dir, "meta.json");
    if (!fs.existsSync(metaPath)) {
      console.warn(`[docs] no index at ${metaPath}; search_liara_docs will return nothing`);
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(metaPath, "utf8")) as IndexMeta & { chunks: DocChunk[] };
    const { chunks, ...meta } = parsed;
    this.chunks = chunks;
    this.meta = meta;
    this.bm25 = buildBM25Index(chunks);
    const binPath = path.join(this.dir, "index.bin");
    if (this.embed && meta.hasDense && fs.existsSync(binPath)) {
      const buf = fs.readFileSync(binPath);
      const vec = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      if (vec.length === meta.count * meta.dims) this.vectors = vec;
    }
  }

  info() {
    this.load();
    return { chunks: this.chunks.length, dense: this.vectors !== null };
  }

  async search(query: string, k = 4): Promise<DocHit[]> {
    this.load();
    if (!this.bm25) return [];
    const lexical: RetrievedChunk[] = bm25Search(this.bm25, query, 20).map(({ docIndex, score }) => ({ ...this.chunks[docIndex]!, score }));

    let ranked: RetrievedChunk[] = lexical;
    let via: DocHit["via"] = "bm25";
    const dense = await this.denseSearch(query, 20);
    if (dense.length) {
      ranked = fuseRRF(lexical, dense, 20).map((c) => ({ ...c, score: c.rrf }));
      via = "hybrid";
    }

    // One hit per page: several chunks of the same page crowd out other sources.
    const seen = new Set<string>();
    const hits: DocHit[] = [];
    for (const c of ranked) {
      if (seen.has(c.url)) continue;
      seen.add(c.url);
      hits.push({
        title: c.title,
        url: c.url,
        heading: c.headingPath.join(" › "),
        snippet: snippetFor(c.text, query),
        score: Number(c.score.toFixed(4)),
        via,
      });
      if (hits.length >= k) break;
    }
    return hits;
  }

  private async denseSearch(query: string, k: number): Promise<RetrievedChunk[]> {
    if (!this.vectors || !this.embed || !this.meta || Date.now() < this.denseDisabledUntil) return [];
    try {
      const res = await fetch(`${this.embed.baseUrl}/embeddings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.embed.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.embed.model, input: [query] }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`embeddings HTTP ${res.status}`);
      const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
      const q = data.data?.[0]?.embedding;
      if (!q || q.length !== this.meta.dims) throw new Error("embedding dims mismatch");
      const qn = Math.sqrt(q.reduce((s, v) => s + v * v, 0)) || 1;
      const { dims, count } = this.meta;
      const scores: Array<{ i: number; s: number }> = [];
      for (let i = 0; i < count; i++) {
        let dot = 0;
        for (let d = 0; d < dims; d++) dot += this.vectors[i * dims + d]! * q[d]!;
        scores.push({ i, s: dot / qn });
      }
      scores.sort((a, b) => b.s - a.s);
      return scores.slice(0, k).map(({ i, s }) => ({ ...this.chunks[i]!, score: s }));
    } catch (err) {
      // Circuit breaker: fall back to BM25 for 5 minutes rather than paying a timeout per query.
      console.warn(`[docs] dense search disabled for 5 min: ${(err as Error).message}`);
      this.denseDisabledUntil = Date.now() + 5 * 60_000;
      return [];
    }
  }
}

/** ~320 chars around the first query term found in the chunk. */
function snippetFor(text: string, query: string): string {
  const body = text.replace(/^#.*\n+/, "").replace(/\s+/g, " ").trim();
  const lower = body.toLowerCase();
  let at = -1;
  for (const t of tokenizeFa(query)) {
    if (t.length < 3) continue;
    at = lower.indexOf(t);
    if (at >= 0) break;
  }
  const start = Math.max(0, at - 100);
  const slice = body.slice(start, start + 320);
  return (start > 0 ? "…" : "") + slice + (start + 320 < body.length ? "…" : "");
}
