# Progress

Newest first. Each entry: what changed, what works, what's next.

## 2026-10-21 (2): M4–M6: console, CLI, chat bot, Docker, docs

**Done**
- `apps/web` console: RTL Persian, chat and approval cards (plan with cost, diffs, env refs, typed
  confirmation, budget override, secret inputs), a live timeline (tool steps, build/app logs, analysis,
  diagnosis, docs citations, health), a summary card with copy-to-share, an audit page with a hash-chain
  check, and the «خرابش کن» panel with a recovery timer. SSE stream of all runs; incident runs are
  auto-selected. Verified in the in-app browser: the wrong-port flow went healthy in 42 s (2 approvals),
  and break-it recovered in 22 s (1 approval).
- `apps/cli`: same runtime, approvals in the terminal, hidden secret input, `--audit`, `--break`.
- Chat bot (Bale/Telegram) inside the console process; allowed chat ids only; incident alerts.
- Docs search filtered to deployment sections and the app's platform.
- Dockerfile + `.dockerignore` + `liara.json` (docker platform, disk at /app/var, health check),
  `/api/health`, optional `CONSOLE_PASSWORD` basic auth.
- `docs/spec-day.md`, `docs/pitch.md` (Persian), README.
- 81 tests green; lint, typecheck, build green (`pnpm gates`).

**Blocked on the user**
- `LIARA_API_TOKEN` (test account) in `.env` → run `pnpm smoke:liara` (read-only).
- An OpenAI-compatible LLM key → run the demo with `MOCK_LLM=false`.
- A Bale bot token + chat id → try the chat hero moment for real.

**Next (prompt 1: verify and harden)**: real-mode dry run on the test account, then live on 2 fixtures
only after the user says so; build the Docker image on a machine with Docker / deploy the console to
Liara; console polish at phone width; MCP server (prompt 2).

## 2026-10-21 (1): M0–M3: repo, Liara client, agent core, analyser, fixtures

- Private repo, pnpm monorepo, OpenAPI spec snapshot + CLI help + `docs/liara-api/NOTES.md`.
- `packages/liara` (real REST + mock client with simulated builds), `packages/core` (runtime, policy,
  safety, audit, analyser, healer, planner, 19 tools, ScriptedBrain, monitor, chaos, LiaraYar docs search).
- 7 fixtures; 74 tests.
