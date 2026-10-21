# Rahandaz (راه‌انداز)

<div dir="rtl">

**راه‌انداز** ایجنت هوش مصنوعی استقرار و نگهداری برای لیاراست. لینک مخزن GitHub را بدهید؛ «راهی»
پروژه را تحلیل می‌کند، نقشه‌ی فارسی استقرار را با هزینه‌ی ماهانه نشان می‌دهد، بعد از تأیید شما دیپلوی
می‌کند، اگر خطا داد ریشه‌اش را با استناد به مستندات لیارا پیدا و به‌صورت diff اصلاح می‌کند، و تا رسیدن
به یک اپ سالم ادامه می‌دهد. هیچ تغییری بدون تأیید شما انجام نمی‌شود، عملیات حساس پیش‌فرض خاموش است،
رمزها هرگز به مدل زبانی نمی‌رسند و هر اقدام در یک گزارش ممیزی زنجیره‌ای ثبت می‌شود.
ساخته‌شده برای هکاتون لیارا.

</div>

**Rahandaz** is an AI DevOps agent for [Liara](https://liara.ir): paste a GitHub link and it ships the
app to Liara and keeps it healthy, safely, in Persian. It is not a chat wrapper around the API. It
finishes the job: analysis → priced plan → approval → deploy with live logs → failure diagnosis with a
docs citation → fix as a reviewable diff → redeploy → verified healthy URL → shareable summary.

> Status: hackathon build. Everything runs offline in mock mode; real Liara mode is implemented from
> the official OpenAPI spec and CLI but not yet verified end to end. See [What works](#what-works).

## Highlights

- **Self-healing deploys.** Seven diagnosis rules (wrong port, missing start script, missing env var,
  Laravel `APP_KEY`, unpinned Werkzeug, bad Docker base image, `PORT` override), each with an exact fix,
  plus fallbacks. Every diagnosis cites a page from Liara's docs.
- **«خرابش کن» (break it on stage).** A judge breaks a healthy app with one click. The health monitor
  notices, starts an incident run by itself, and the app is healthy again after one approval. A timer
  shows how long it took.
- **Deploy from a chat message.** A Bale/Telegram bot: send a link, approve with buttons, get the URL.
- **Safety in code, not in the prompt.** Approvals are bound to exact calls, destructive actions are
  gated (`ALLOW_DESTRUCTIVE` + typed resource name), there is `DRY_RUN`, a budget guard and
  `ALLOWED_APPS`, a secret vault + redaction, prompt-injection wrapping, and a hash-chained audit log.
- **Persian-first console**: RTL, Vazirmatn, Persian digits, live timeline, approval cards, audit page;
  works on a phone.

## Quick start (offline, mock mode)

```bash
pnpm install
cp .env.example .env     # mock Liara + mock LLM; set ALLOW_DESTRUCTIVE=true for «خرابش کن»
pnpm dev                 # http://localhost:3200
```

Click a sample broken repo (or paste `https://github.com/any/node-wrong-port`). In mock mode, links whose
repo name matches a folder in `fixtures/` load that fixture.

```bash
pnpm cli "https://github.com/acme/python-unpinned"   # same agent in the terminal
pnpm cli --break demo-shop                            # break it, then watch it heal
pnpm cli --audit                                      # audit log + hash-chain check
pnpm gates                                            # lint + typecheck + tests + build
```

## Real mode

```bash
# .env
LIARA_MODE=real
LIARA_API_TOKEN=...          # a separate test account, short-lived token
ALLOWED_APPS=rahandaz-*      # the agent may only change apps matching this
# DRY_RUN defaults to true in real mode: plans and shows exact API calls, executes nothing.

pnpm smoke:liara             # read-only: proves the token works (GET /v1/me, /v1/projects)
pnpm dev
```

Real LLM: `MOCK_LLM=false LLM_BASE_URL=… LLM_API_KEY=… LLM_MODEL=…`, any OpenAI-compatible provider with tool
calling. Liara's own AI service is refused at startup (hackathon rule).

Live changes: `DRY_RUN=false`, only on a test account.

## Architecture

```
apps/web  (Next.js console) ─┐
apps/cli  (terminal)        ─┼─► packages/core: AgentRuntime: LLM ⇄ tools → policy → execute | ask | block
chat bot  (Bale/Telegram)   ─┘          │   analyser · planner · healer · docs search · vault · audit
                                        ▼
                         packages/liara: LiaraClient ── RealLiaraClient (REST, docs/liara-api)
                                                     └─ MockLiaraClient (simulated builds from the source tree)
```

`CLAUDE.md` has the details: safety rules, how the policy layer enforces them, how to add a tool or a
fixture, and the run modes.

## What works

| Area | Status |
|---|---|
| Full demo flow on 6 broken fixtures + 1 healthy, mock mode | ✅ tested end to end (vitest) and in the console |
| Break it on stage, health monitor, incident runs | ✅ tested |
| Chat bot (Bale/Telegram API) | ✅ tested against a fake Bot API; not yet tried on a real Bale bot |
| Policy layer, redaction, vault, injection defence, audit chain, budget guard, DRY_RUN | ✅ tested |
| Real Liara REST client | ✅ request shapes tested with a fake fetch; ⚠️ not yet run against a real account |
| Real LLM provider | implemented; ⚠️ needs a key to verify |
| Docker image / deploy console on Liara | Dockerfile + liara.json written; ⚠️ not built locally (no Docker on the dev box) |

**Mocked**: Liara itself in mock mode (builds are simulated by `packages/liara/src/mock/simulate.ts`, which
reads your files and fails the way npm/pip/Docker/Laravel/Next.js would), and the agent's reasoning when
`MOCK_LLM=true` (`ScriptedBrain`: deterministic, but it reacts to real tool results).

**UNVERIFIED** (see `docs/liara-api/NOTES.md`): plan IDs and Toman prices (hardware names from the docs,
prices are placeholders, and the UI says so); `api.liara.ir` vs `api.iran.liara.ir`; the
`/v2/releases/{id}/build-logs` and `/v1/releases/{id}` endpoints (taken from the CLI source, not the spec);
Liara's app status strings; the `*.liara.run` default URL; the `update-envs` merge semantics.

## Credits

- **LiaraYar** ([amirhosein3000/liarayar](https://github.com/amirhosein3000/liarayar)): the Persian
  tokenizer, BM25 and RRF fusion in `packages/core/src/knowledge/vendor/`, and the prebuilt index of
  Liara's documentation in `data/liara-docs/`, are vendored from LiaraYar.
- Liara's [OpenAPI spec](https://github.com/liara-cloud/openapi) and `@liara/cli` are the source of truth
  for every endpoint used.
- Rahandaz is an independent hackathon project, not an official Liara product.
