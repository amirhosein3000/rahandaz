# Liara API: what we rely on, and where each fact comes from

Sources of truth, in order:

1. `spec/*.yaml`: snapshot of [liara-cloud/openapi](https://github.com/liara-cloud/openapi) at commit
   `338325a42cd28d12dcee10c088840d2098504a8b` (2026-10-17). Files: `paas.yaml`, `dbaas.yaml`, `me.yaml`,
   `billing.yaml`, `dns.yaml`, `object-storage.yaml`.
2. `cli-help.txt`: `liara <topic> --help` output from `@liara/cli` 9.6.0.
3. **CLI source** (`@liara/cli@9.6.0`, `lib/**`, read but not vendored). Used only for endpoints that the
   OpenAPI spec lacks. These are tagged `CLI-SOURCE` below. They're real requests the official client
   sends, but they aren't documented, so treat them as less stable.

Anything not in one of these three is `UNVERIFIED`. The code marks it with the same word.

## Base URL and auth

| Fact | Source |
|---|---|
| Base URL `https://api.liara.ir` (spec `servers`) | spec |
| CLI maps both regions `iran` and `germany` to `https://api.liara.ir`; also defines `API_IR_URL = https://api.iran.liara.ir` | CLI-SOURCE (`lib/constants.js`) |
| `Authorization: Bearer <api token>` | spec (`bearerAuth`), CLI-SOURCE (`lib/base.js`) |
| Team scoping: `?teamID=<id>` query param on every request (empty = personal account) | spec description, CLI-SOURCE (`lib/base.js`) |

We default to `https://api.liara.ir` (spec) and allow `LIARA_API_BASE_URL` to override (e.g. to
`https://api.iran.liara.ir`, which the kickoff brief mentioned). Which of the two is preferred for the
`iran` region is `UNVERIFIED`.

## Endpoints used by `RealLiaraClient`

| Capability | Method + path | Tag | Source |
|---|---|---|---|
| List apps | `GET /v1/projects` → `{ projects: [...] }` | read | spec `getApps` |
| App details (incl. env **names**) | `GET /v1/projects/{name}` → `{ project: {...} }` | read | spec `getAppByName` |
| Create app | `POST /v1/projects` `{ name, planID, platform, network?, readOnlyRootFilesystem? }` | mutating | spec `createApp` |
| Delete app | `DELETE /v1/projects/{name}` | destructive | spec `deleteAppByName` |
| Turn on/off | `POST /v1/projects/{name}/actions/scale` `{ scale: 0\|1 }` | mutating (1) / destructive (0) | spec `turnApp` |
| Restart | `POST /v1/projects/{name}/actions/restart` | mutating | spec `restartApp` |
| Change plan | `POST /v1/projects/{name}/resize` `{ planID }` | mutating | spec `changePlan` |
| Set env vars | `POST /v1/projects/update-envs` `{ project, variables: [{key,value}] }` | mutating; destructive when it overwrites an existing key | spec `updateEnvs` |
| Upload source | `POST /v2/projects/{name}/sources` multipart `file` (.tar.gz) → `{ sourceID }` | mutating | spec `sourcesDeploy`, CLI-SOURCE (`services/upload.js`) |
| Create release | `POST /v2/projects/{name}/releases` `{ sourceID, port, type, ... }` → `{ releaseID }` | mutating | spec `releasesDeploy` (CLI also sends `build`, `envs`, `disks`, `gitInfo`, `platformConfig`, `healthCheck`) |
| Release status | `GET /v1/releases/{releaseID}` → `{ release: { state, queue, failReason? } }` | read | CLI-SOURCE (`commands/deploy.js`) |
| Build logs | `GET /v2/releases/{releaseID}/build-logs?since=<createdAt>` → `{ release, buildOutput: [{ stream: 'STDOUT'\|..., line, createdAt }] }` | read | CLI-SOURCE (`services/build-logs.js`) |
| Release states seen by the CLI | `BUILDING`, `PUSHING`, `PUSHED`, `DEPLOYING`, `READY`, `FAILED`(+`failReason`), `UNHEALTHY`, `CANCELED`, `TIMEDOUT` | n/a | CLI-SOURCE |
| List releases | `GET /v1/projects/{name}/releases?page=&count=` | read | spec `getAppReleases` |
| Runtime logs | `GET /v1/projects/{name}/logs?since=` (spec) / `GET /v2/projects/{name}/logs?start=&direction=forward` (CLI) | read | spec `getAppLogs`, CLI-SOURCE |
| Events | `GET /v1/projects/{name}/events?start=&end=` | read | spec `getAppEvents` |
| Metrics summary | `GET /v1/projects/{name}/metrics/summary` | read | spec |
| CPU / memory | `GET /v1/projects/{name}/metrics/{cpu\|memory}?since=` | read | spec |
| Disks | `GET /v1/projects/{id}/disks`, `POST /v1/projects/{name}/disks` | read / mutating | spec |
| Domains | `GET /v1/domains`, `POST /v1/domains` | read / destructive (domain changes) | spec |
| Databases | `GET /v1/databases`, `POST /v1/databases` | read / mutating | spec (`dbaas.yaml`) |
| Account + **plans catalogue** | `GET /v1/me` → `{ user, team, plans: { projects, databases, ... } }` | read | spec (`me.yaml`), but the plan object's inner shape is `additionalProperties: true` → **UNVERIFIED** |

## Default ports per platform (CLI-SOURCE `utils/get-port.js`)

`static, python, react, vue, angular, laravel, wordpress, django, flask, php` → **80**; `next` → **3000**;
`go` → **8080**; `dotnet` → 80; anything else (e.g. `node`, `docker`) → **3000**.

Supported platforms (`AVAILABLE_PLATFORMS`): `node, laravel, php, python, django, flask, dotnet, react,
angular, vue, static, docker, next, go`.

## Known gaps (UNVERIFIED)

- Plan IDs and monthly prices. `GET /v1/me` returns a plan catalogue, but its fields are untyped in the
  spec. The mock plan table in `packages/liara/src/plans.ts` uses placeholder IDs and Toman prices, all
  marked `UNVERIFIED`. The real client reads the catalogue live and falls back to the mock table if a field is missing.
- Default app URL `https://<app>.liara.run`: widely used in Liara docs, but not stated in the spec.
- Exact `failReason` strings and health-check behaviour of `UNHEALTHY` releases.
