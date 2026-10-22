# Progress

Newest first. Each entry: what changed, what works, what's next.

## 2026-10-22: real token, console deployed on Liara

- Token works (`pnpm smoke:liara` green). The account's balance is in its **team** (team ID
  `6a874d2dfbcb940778bf8753`); personal-account creates fail with 402. Pass `--team-id` / `teamID`.
- Live 400 showed `POST /v1/projects` requires `bundlePlanID` (free/basic/standard/pro; basic = Bronze);
  fixed in `LiaraRequests.createApp` (default `basic`, `free` for the free plan). The app create also
  needs a network on this account (`mizan-net`, the only one).
- Console deployed with the official CLI: **https://rahandaz-console.liara.run** (docker, `small-g2`,
  Bronze, disk `rahandaz-data` 1GB at /app/var). Env: `LIARA_MODE=mock MOCK_LLM=true
  ALLOW_DESTRUCTIVE=true CONSOLE_PASSWORD=…` (password kept outside the repo in
  `E:\hackaton\rahandaz-console-password.txt`; any username).
- `.dockerignore` now excludes `.claude/` (other sessions' worktrees) and the local token file.
- Verified live over HTTP: password enforced (401 without), health OK, a mock deploy
  (node-wrong-port) end to end in ~5s, and «خرابش کن» → RAM pressure → monitor incident → SRE report →
  plan upgrade approval → health 40 → 100.
- Gap: the summary card of an SRE run has no root cause / fix (fields empty); fill them from the SRE report.
- Next: real-mode dry run locally against the team; Liara AI key; video.

## 2026-10-21 (4): official spec → SRE agent, beginner UX, domains, automation, limits, submission docs

The real brief arrived (docs/spec.md, scoring 100/100/50/50). Built against it:
- **SRE agent** (`src/sre/*`, tool `sre_check`): health probes, CPU/RAM, log analysis (HTTP error rate,
  p50/p95, error clusters), releases, failure rules → 8 checks, ranked causes with evidence, action or
  guidance, API limitations, before/after verification. Mock: traffic logs, `memory_pressure` (slow) and
  `db_down` (HTTP 500) scenarios. Monitor treats slowness (>2 s) as an incident.
- **Model**: Liara AI (`LIARA_AI_*`) or any OpenAI-compatible provider, other one as automatic fallback.
- **UX**: beginner home (one input, three intents, apps with one-click health check / publish new
  version), stage indicator with current activity, SRE report card, domain checklist card, CI card,
  risk tier + undo hint on approvals, follow-up messages continue the conversation.
- **Domains**: add_domain, setup_dns (Liara DNS zone + ALIAS/TXT, record shapes from CLI source),
  enable_ssl, domain_status checklist; the IRNIC nameserver step is handed to the user with exact values.
- **Automation**: app→repo memory (publish new version = one click), `generate_ci` (GitHub Actions from
  Liara's CI/CD docs).
- **Limits**: `CAPABILITIES` register → `/limits` page and `explain_limitations` tool.
- **Docs**: `docs/SUBMISSION.md` (Persian, required md), `docs/demo-script.md` (5-minute video script).
- Fixed: redactor hid domain `value` fields (renamed to `text`); docs index now shared per process (test
  suite 12 s, was flaky); SRE headline prioritises slowness; DB docs query names the DB and platform.
- 111 tests; gates green.

**Still blocked on the user**: `LIARA_API_TOKEN` (real-mode smoke + dry run, then live only with the
user's go-ahead), a Liara AI key or other LLM key, a Bale bot token; recording the demo video.

## 2026-10-21 (3): prompt 1, verify and harden (part 1, without a Liara token)

**Fixed after an SRE-style review**
- CSRF: every console POST must be JSON and same-origin (`checkWriteRequest`). Before, a cross-site
  `text/plain` form could have carried an approval using cached Basic-auth credentials.
- Open console: `proxy.ts` puts Basic auth on pages + API; a production console without
  `CONSOLE_PASSWORD` refuses all changes (override: `ALLOW_OPEN_CONSOLE=true`).
- Stale approvals: unused plan pre-approvals now die with the run.
- Limits: `MAX_RUN_TOKENS` token budget, `TOOL_TIMEOUT_MS` per tool call (waits declare their own).
- Partial deploys: every applied change is recorded with an undo hint; stop messages and the summary
  card list them. Before, the mock brain claimed "nothing half-done" even after `create_app`.
- Rate limits / 5xx while following a build are retried with back-off (reads only, never POSTs).
- Upload size cap 256 MiB (same as the CLI).
- UX: non-secret env vars default to the repo's `.env.example` value (`example:KEY`). The Laravel plan
  used to ask the user to type 4 harmless values.
- Console: phone layout (compact header, panels 78dvh), bidi isolation of Latin runs inside Persian text
  (`components/fa.tsx`), wrapping evidence, applied-changes box on failed summaries.

**Proven with tests (99 total)**: no mutating call without approval; destructive unreachable without
`ALLOW_DESTRUCTIVE` + typed name; DRY_RUN executes nothing; secrets absent from LLM messages, events,
audit; instructions planted in README, code comments and app logs are flagged and powerless; malformed
tool calls, LLM outage, step and token limits, repeated failures, Liara 5xx mid-deploy, 429 during a build,
hung tool calls; CSRF guard.

**Checked by hand in the browser**: 375×812 (no horizontal overflow; logs wrap), 1280×800 (panels
fill the viewport).

**Still open (need the user)**: real-mode dry run + 2 fixtures live on the test account (needs
`LIARA_API_TOKEN`, and the user's go-ahead for `DRY_RUN=false`); real LLM run; real Bale bot; Docker build.

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
