# Liara docs index (vendored from LiaraYar)

`meta.json` (3,735 chunks of docs.liara.ir, Persian) and `index.bin` (dense vectors, 1536-d,
`openai/text-embedding-3-small`, L2-normalised Float32 row-major) were built by
[LiaraYar](https://github.com/amirhosein3000/liarayar) `scripts/ingest.ts` at commit a37aacf
from liara-cloud/docs commit `dbb7430` (built 2026-08-22).

BM25 needs only `meta.json`. Dense/hybrid search needs `EMBED_BASE_URL` + `EMBED_API_KEY` for an
OpenAI-compatible endpoint serving the same embedding model (not Liara's AI service).
