# Spec day playbook

Use this the moment the official spec for «ایجنت هوش مصنوعی برای لیارا برای دواپس و دپلوی» is published.
Paste the prompt below into a fresh Claude Code session (Opus) at the repo root, with the spec under it.

## The prompt

```
The official spec is below. Read CLAUDE.md, docs/progress.md and docs/spec-day.md first.
Do NOT write code until I approve the plan.

Time budget: 2-day event, ~4 build hours on day 1 and ~2 on day 2 before a feature freeze at midday
of day 2. Prefer adapting existing modules over building new ones. Keep the hero moments from CLAUDE.md
(«خرابش کن» and deploy-from-chat) in the demo unless the spec rules them out; if it does, propose a new
hero moment that fits. By the end of day 1 the demo path must work end to end and be deployed.

1. Summarise the spec in 5 bullets: judging criteria + weights, deliverables, rules about accounts,
   credits, allowed APIs/LLMs, required interfaces (web, CLI, chat, MCP).
2. Fill the mapping table in docs/spec-day.md (requirement → module → built / change / new / out),
   flag ambiguities with your recommended reading.
3. Who is the user (Liara's customers vs Liara's ops team)? Recommend the split of effort.
4. One-sentence product story + 90-second demo script aimed at the highest-weight criteria.
5. Must / nice / cut lists (with the env flags to switch things off).
6. Parallel tasks that don't touch the same files: files, acceptance check, rough time.
7. Riskiest task first, and how to de-risk it.

SPEC:
<paste here>
```

## What already exists (map requirements onto these first)

| Capability | Module / file | Flag / entry | Status |
|---|---|---|---|
| Repo link → analysis (stack, port, env names, DB/disk, risks) | `core/src/analyser/analyse.ts`, tool `analyse_repo` | always on | built, 11 tests |
| Persian deployment plan + monthly cost + budget guard | `core/src/planner/plan.ts`, tool `propose_deploy_plan` | `MAX_MONTHLY_COST` | built (prices UNVERIFIED) |
| Plan → approve → apply, exact-call approvals | `core/src/policy/policy.ts`, `agent/runtime.ts` | always on | built, tested |
| Deploy + live build logs | tools `deploy_app`, `wait_for_release`; `liara/src/real/rest.ts` | `LIARA_MODE` | mock tested; real UNVERIFIED end-to-end |
| Self-healing (diagnosis + docs citation + diff fix + redeploy) | `core/src/healer/diagnose.ts`, tools `diagnose_failure`, `apply_fix` | `MAX_HEAL_ATTEMPTS` | 7 rules with fixes (+2 fallbacks), tested on 6 fixtures |
| Liara docs knowledge | `core/src/knowledge/*` (LiaraYar BM25 + optional dense) | `EMBED_*` for hybrid | built |
| Operate: "why is my app down/slow?" | ScriptedBrain operate flow; tools `get_app_status`, `get_app_logs`, `get_metrics` | — | built (mock) |
| Incident auto-detection | `core/src/agent/monitor.ts` | `HEALTH_MONITOR`, `HEALTH_MONITOR_INTERVAL_MS` | built |
| «خرابش کن» break-it demo | `core/src/agent/chaos.ts`, `web/components/break-panel.tsx` | `ALLOW_DESTRUCTIVE=true` | built, tested |
| Chat (Bale/Telegram) deploy + approvals as buttons | `core/src/chat/chat-bot.ts` | `CHAT_BOT_TOKEN`, `CHAT_ALLOWED_IDS` | built, tested against a fake Bot API; not tried on real Bale |
| Web console (RTL, timeline, approvals, audit) | `apps/web` | `CONSOLE_PASSWORD` | built |
| CLI | `apps/cli` | `pnpm cli` | built |
| Safety: DRY_RUN, destructive gate, ALLOWED_APPS, secrets vault/redaction, injection defence, audit chain | `core/src/policy`, `core/src/safety`, `core/src/audit` | `DRY_RUN`, `ALLOW_DESTRUCTIVE`, `ALLOWED_APPS` | built, tested |
| Real LLM | `core/src/llm/openai-compatible.ts` | `MOCK_LLM=false`, `LLM_*` | built; needs a key |
| MCP server | — | — | NOT built (prompt 2, module 7) |
| CI/CD generator, cost advisor, DB helper, security check, migration | — | — | NOT built (prompt 2) |

## Mapping table (fill on the day)

| Requirement (from spec) | Module | Built / Change / New / Out | Notes |
|---|---|---|---|
| | | | |

## Likely spec readings and the cheapest response

- **"Agent for Liara's customers"** → current product as is. Lead with the demo flow + «خرابش کن».
- **"Agent for Liara's ops/support team"** (triage across many apps) → reuse operate flow + monitor;
  add a multi-app incident list page (new, ~2h) and run diagnosis over many apps (loop in monitor).
- **"Must use MCP"** → build `apps/mcp` exposing `ToolRegistry` through the same `AgentRuntime.handleCall`
  policy path (approvals via the console). ~2–3h.
- **"Cost optimisation is judged"** → cost advisor: metrics vs plan → resize suggestion via `resize_app`. ~2h.
- **"Must use their LLM/credits"** → swap `LLM_BASE_URL` if allowed by the rules (Liara AI is currently
  refused in `loadConfig`; change only if the spec explicitly allows it).
- **"Given test cluster / log format"** → new `LiaraClient` implementation or an adapter in `real/rest.ts`;
  mock stays for the demo.

## Must / nice / cut (default, before reading the spec)

- **Must**: the deploy → fail → heal → healthy flow, «خرابش کن», safety story (approvals, DRY_RUN,
  audit), console deployed on Liara, real LLM key wired, eval numbers if success rate is judged.
- **Nice**: chat-bot live demo from a phone, hybrid docs search (`EMBED_*`), MCP server.
- **Cut first**: extra fixtures, cost advisor, migration assistant.

## Demo script skeleton (90 s)

1. (10 s) Problem: deploying + debugging on a PaaS costs developers hours and Liara support tickets.
2. (35 s) Paste `github.com/…/node-wrong-port` → analysis (injection in README flagged and ignored) →
   plan with cost → approve → build logs stream → UNHEALTHY → root cause + liara.json docs link →
   diff → approve → healthy URL → summary card.
3. (30 s) Judge clicks «خرابش کن» → monitor alarm → diagnosis → one approval → healthy, timer shows seconds.
4. (15 s) Safety: audit page (hash chain ✓), destructive gate, secrets never reach the model.

## Parallel task template

| Task | Files (exclusive) | Acceptance | Time |
|---|---|---|---|
| | | | |
