# Progress

Newest first. Each entry: what changed, what works, what's next.

## 2026-10-21: M0–M3: repo, Liara client, agent core, analyser, fixtures

**Done**
- Private repo `amirhosein3000/rahandaz`, pnpm monorepo, lint/typecheck/vitest wired.
- `docs/liara-api/`: OpenAPI spec snapshot (liara-cloud/openapi @ 338325a), `@liara/cli` 9.6.0 help
  output, `NOTES.md` listing every endpoint used and its source (spec / CLI source / UNVERIFIED).
  Deploy is pure REST: upload the source (`POST /v2/projects/{name}/sources`), then create a release
  (`/v2/projects/{name}/releases`); build logs come from `GET /v2/releases/{id}/build-logs`, which is
  in the CLI source but not in the spec.
- `packages/liara`: `LiaraClient`, `RealLiaraClient` (REST, retries GET only, teamID scoping),
  `MockLiaraClient` (simulated builds from the actual source tree, streaming logs, chaos hooks),
  `LiaraRequests` (exact calls shared by real client + DRY_RUN), plan table (names/hardware from
  docs; IDs and prices UNVERIFIED), read-only smoke script.
- `packages/core`: agent runtime (loop, executor, approvals, events), policy layer, redactor, vault,
  untrusted wrapping + injection scanner, hash-chained audit log, analyser, healer (7 rules with fixes),
  planner with cost + budget guard, 19 typed tools, OpenAI-compatible provider, ScriptedBrain mock LLM,
  health monitor, «خرابش کن» chaos, `search_liara_docs` over the vendored LiaraYar index.
- 7 fixtures (6 broken + demo-shop). 74 tests green: every fixture deploys to healthy in mock mode,
  with the right diagnosis, a docs citation, and the right fix.

**Not yet verified against a real account**: the smoke test (it needs `LIARA_API_TOKEN` in `.env`).

**Next**: CLI, web console, chat bot, real-mode dry run, docs (spec-day, pitch, README).
