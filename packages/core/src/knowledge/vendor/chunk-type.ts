// Vendored from LiaraYar (https://github.com/amirhosein3000/liarayar), src/lib/chunk.ts (types only)
// and src/lib/retriever.ts (RetrievedChunk).

export type ChunkKind = "doc" | "error";

export type DocChunk = {
  id: string;
  url: string;
  sourcePath: string;
  title: string;
  breadcrumb: string;
  section: string;
  platform: string | null;
  kind: ChunkKind;
  headingPath: string[];
  text: string;
  /** Rough word count — doc-length signal for reporting, not the tokenizer's output. */
  tokens: number;
};

export type RetrievedChunk = DocChunk & { score: number };
