/**
 * In-memory Liara for demos and tests. Releases are simulated from the
 * uploaded source tree (see simulate.ts) and progress over wall-clock time, so
 * the console shows build logs streaming in. `MOCK_LATENCY_SCALE=0` makes every
 * release settle instantly (tests).
 */
import type { LiaraClient } from "../client";
import { LiaraApiError } from "../client";
import { FALLBACK_PLANS } from "../plans";
import type {
  Account,
  AppDetails,
  AppLogLine,
  AppStatus,
  BuildLogLine,
  CreateAppInput,
  CreateDatabaseInput,
  DatabaseInfo,
  DeployInput,
  DiskInfo,
  DomainInfo,
  EnvVarWrite,
  HealthResult,
  LiaraApp,
  MetricsSummary,
  Plan,
  Release,
  ReleaseState,
} from "../types";
import { simulateRelease, type SimulatedOutcome } from "./simulate";
import { snapshotDir, type FileSnapshot } from "./snapshot";

export type ChaosScenario = "missing_env" | "wrong_port";

export interface MockSeedApp {
  name: string;
  platform: string;
  planId: string;
  sourceDir: string;
  port: number;
  env: Record<string, string>;
}

export interface MockLiaraClientOptions {
  /** Multiplies all simulated delays. 0 = instant. Default 1. */
  latencyScale?: number;
  seed?: MockSeedApp[];
  now?: () => number;
}

interface MockRelease {
  id: string;
  app: string;
  port: number;
  platform: string;
  files: FileSnapshot;
  startedAt: number;
  outcome: SimulatedOutcome;
  /** ms offsets for each build line, and for the final state. */
  lineOffsets: number[];
  settleAt: number;
  applied: boolean;
}

interface MockApp {
  name: string;
  id: string;
  platform: string;
  planId: string;
  scale: 0 | 1;
  createdAt: string;
  env: Map<string, string>;
  releases: MockRelease[];
  /** Runtime of the live release (changes on env update / restart / chaos). */
  runtime: SimulatedOutcome | null;
  logs: AppLogLine[];
  restarts: number;
}

const LINE_MS = 280;
const DEPLOY_MS = 2500;

export class MockLiaraClient implements LiaraClient {
  readonly mode = "mock" as const;
  private apps = new Map<string, MockApp>();
  private releases = new Map<string, MockRelease>();
  private databases: DatabaseInfo[] = [];
  private seq = 0;
  private readonly scale: number;
  private readonly now: () => number;

  constructor(opts: MockLiaraClientOptions = {}) {
    this.scale = opts.latencyScale ?? 1;
    this.now = opts.now ?? Date.now;
    for (const seed of opts.seed ?? []) this.seedApp(seed);
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq.toString(36).padStart(4, "0")}`;
  }

  private requireApp(name: string): MockApp {
    const app = this.apps.get(name);
    if (!app) throw new LiaraApiError(`Liara API (mock): app "${name}" does not exist`, 404, `/v1/projects/${name}`, false);
    this.settle(app);
    return app;
  }

  private seedApp(seed: MockSeedApp) {
    const app = this.newApp({ name: seed.name, platform: seed.platform, planId: seed.planId });
    for (const [k, v] of Object.entries(seed.env)) app.env.set(k, v);
    const release = this.startRelease(app, { app: seed.name, sourceDir: seed.sourceDir, port: seed.port, platform: seed.platform }, true);
    this.settle(app);
    return release;
  }

  private newApp(input: CreateAppInput): MockApp {
    const app: MockApp = {
      name: input.name,
      id: this.nextId("app"),
      platform: input.platform,
      planId: input.planId,
      scale: 1,
      createdAt: new Date(this.now()).toISOString(),
      env: new Map(),
      releases: [],
      runtime: null,
      logs: [],
      restarts: 0,
    };
    this.apps.set(input.name, app);
    return app;
  }

  private startRelease(app: MockApp, input: DeployInput, instant = false): MockRelease {
    const files = snapshotDir(input.sourceDir);
    const outcome = simulateRelease({ files, platform: input.platform, port: input.port, env: app.env });
    const scale = instant ? 0 : this.scale;
    const lineOffsets = outcome.buildLines.map((_, i) => Math.round((i + 1) * LINE_MS * scale));
    const buildEnd = lineOffsets[lineOffsets.length - 1] ?? 0;
    const release: MockRelease = {
      id: this.nextId("rel"),
      app: app.name,
      port: input.port,
      platform: input.platform,
      files,
      startedAt: this.now(),
      outcome,
      lineOffsets,
      settleAt: buildEnd + (outcome.buildOk ? Math.round(DEPLOY_MS * scale) : 0),
      applied: false,
    };
    app.releases.push(release);
    this.releases.set(release.id, release);
    return release;
  }

  /** Apply a settled release's runtime to its app (idempotent). */
  private settle(app: MockApp) {
    const latest = app.releases[app.releases.length - 1];
    if (!latest || latest.applied) return;
    if (this.now() - latest.startedAt < latest.settleAt) return;
    latest.applied = true;
    if (!latest.outcome.buildOk) return; // failed builds never replace the running release
    app.runtime = latest.outcome;
    if (latest.outcome.finalState === "UNHEALTHY") app.restarts += 3;
    this.appendLogs(app, latest.outcome.runtimeLines);
  }

  private appendLogs(app: MockApp, lines: string[]) {
    const t = this.now();
    lines.forEach((message, i) => {
      app.logs.push({
        ts: new Date(t + i).toISOString(),
        type: message.startsWith("[system]") ? "system" : /error|exception|traceback/i.test(message) ? "stderr" : "stdout",
        message,
      });
    });
    if (app.logs.length > 2000) app.logs.splice(0, app.logs.length - 2000);
  }

  /** Re-run the live release with the app's current env (what a restart does). */
  private rerun(app: MockApp, reason: string) {
    const live = [...app.releases].reverse().find((r) => r.applied && r.outcome.buildOk);
    if (!live) return;
    this.appendLogs(app, [`[system] ${reason}: restarting containers`]);
    const outcome = simulateRelease({ files: live.files, platform: live.platform, port: live.port, env: app.env });
    // A rebuild-time failure (e.g. Next.js env) shows up at runtime after a restart.
    const runtime: SimulatedOutcome = outcome.buildOk
      ? outcome
      : { ...outcome, finalState: "UNHEALTHY", runtimeLines: outcome.buildLines.slice(-4), httpStatus: 0 };
    if (runtime.finalState === "UNHEALTHY") app.restarts += 3;
    app.runtime = runtime;
    this.appendLogs(app, runtime.runtimeLines);
  }

  private status(app: MockApp): AppStatus {
    const latest = app.releases[app.releases.length - 1];
    if (!latest) return "not_deployed";
    if (app.scale === 0) return "stopped";
    if (!latest.applied) return "deploying";
    if (!app.runtime) return "not_deployed";
    return app.runtime.finalState === "UNHEALTHY" ? "crashed" : "running";
  }

  private toApp(app: MockApp): LiaraApp {
    return {
      name: app.name,
      id: app.id,
      platform: app.platform,
      status: this.status(app),
      planId: app.planId,
      scale: app.scale,
      isDeployed: app.runtime !== null,
      createdAt: app.createdAt,
    };
  }

  // ── read-only ────────────────────────────────────────────────

  async whoami(): Promise<Account> {
    return { email: "demo@rahandaz.local", fullname: "Demo account (mock)" };
  }

  async listApps(): Promise<LiaraApp[]> {
    return [...this.apps.values()].map((a) => {
      this.settle(a);
      return this.toApp(a);
    });
  }

  async getApp(name: string): Promise<AppDetails | null> {
    if (!this.apps.has(name)) return null;
    const app = this.requireApp(name);
    const live = [...app.releases].reverse().find((r) => r.applied && r.outcome.buildOk);
    return { ...this.toApp(app), envKeys: [...app.env.keys()], port: live?.port, url: this.appUrl(name) };
  }

  async getRelease(app: string, releaseId: string): Promise<Release> {
    const r = this.releases.get(releaseId);
    if (!r || r.app !== app) throw new LiaraApiError(`release ${releaseId} not found`, 404, `/v1/releases/${releaseId}`, false);
    this.settle(this.apps.get(app)!);
    const elapsed = this.now() - r.startedAt;
    const buildEnd = r.lineOffsets[r.lineOffsets.length - 1] ?? 0;
    let state: ReleaseState;
    if (elapsed >= r.settleAt) state = r.outcome.finalState;
    else if (elapsed >= buildEnd) state = "DEPLOYING";
    else if (elapsed < LINE_MS * this.scale) state = "QUEUED";
    else state = "BUILDING";
    const failReason = elapsed >= r.settleAt ? r.outcome.failReason : undefined;
    return { id: r.id, app, state, failReason, port: r.port, createdAt: new Date(r.startedAt).toISOString() };
  }

  async getBuildLogs(releaseId: string, since?: string): Promise<BuildLogLine[]> {
    const r = this.releases.get(releaseId);
    if (!r) throw new LiaraApiError(`release ${releaseId} not found`, 404, `/v2/releases/${releaseId}/build-logs`, false);
    const elapsed = this.now() - r.startedAt;
    const after = since === undefined ? -1 : Number(since);
    const out: BuildLogLine[] = [];
    r.outcome.buildLines.forEach((line, i) => {
      if (i > after && r.lineOffsets[i]! <= elapsed) {
        out.push({ stream: /error|failed|not found/i.test(line) ? "STDERR" : "STDOUT", line, createdAt: String(i) });
      }
    });
    return out;
  }

  async getAppLogs(name: string, sinceUnix: number): Promise<AppLogLine[]> {
    const app = this.requireApp(name);
    const since = sinceUnix * 1000;
    return app.logs.filter((l) => Date.parse(l.ts) >= since).slice(-300);
  }

  async getMetrics(name: string): Promise<MetricsSummary> {
    const app = this.requireApp(name);
    const healthy = this.status(app) === "running" && app.runtime?.httpStatus === 200;
    const plan = FALLBACK_PLANS.find((p) => p.id === app.planId);
    const jitter = (app.name.length * 7) % 5;
    return {
      cpuPercent: app.scale === 0 ? 0 : healthy ? 9 + jitter : 1,
      memoryMb: app.scale === 0 ? 0 : healthy ? 168 + jitter * 11 : 41,
      memoryLimitMb: plan?.ramMb ?? null,
      restarts: app.restarts,
      responseMsP50: healthy ? 84 + jitter * 6 : null,
    };
  }

  async listPlans(): Promise<Plan[]> {
    return FALLBACK_PLANS;
  }

  async listDatabases(): Promise<DatabaseInfo[]> {
    return [...this.databases];
  }

  async listDisks(_app: string): Promise<DiskInfo[]> {
    return [];
  }

  async listDomains(): Promise<DomainInfo[]> {
    return [];
  }

  appUrl(app: string): string {
    return `https://${app}.liara.run`;
  }

  async checkHealth(name: string): Promise<HealthResult> {
    const url = this.appUrl(name);
    const app = this.apps.get(name);
    if (!app) return { ok: false, url, status: 404, error: "app not found" };
    this.settle(app);
    if (app.scale === 0) return { ok: false, url, status: 503, latencyMs: 40, error: "app is turned off" };
    if (!app.runtime) return { ok: false, url, status: 404, latencyMs: 35, error: "no release is live yet" };
    const s = app.runtime.httpStatus;
    if (s === 0) return { ok: false, url, status: 502, latencyMs: 3000, error: "upstream connect error (app not listening)" };
    return { ok: s < 500, url, status: s, latencyMs: s < 500 ? 96 : 210 };
  }

  // ── mutating ─────────────────────────────────────────────────

  async createApp(input: CreateAppInput): Promise<void> {
    if (this.apps.has(input.name)) throw new LiaraApiError(`app "${input.name}" already exists`, 409, "/v1/projects", false);
    if (!/^[a-z0-9][a-z0-9-]{2,31}$/.test(input.name)) throw new LiaraApiError("invalid app name", 400, "/v1/projects", false);
    this.newApp(input);
  }

  async setEnvVars(name: string, vars: EnvVarWrite[]): Promise<void> {
    const app = this.requireApp(name);
    for (const v of vars) app.env.set(v.key, v.value);
    this.rerun(app, `env updated (${vars.map((v) => v.key).join(", ")})`);
  }

  async deploy(input: DeployInput): Promise<{ releaseId: string }> {
    const app = this.requireApp(input.app);
    const r = this.startRelease(app, input);
    return { releaseId: r.id };
  }

  async restartApp(name: string): Promise<void> {
    this.rerun(this.requireApp(name), "restart requested");
  }

  async resizeApp(name: string, planId: string): Promise<void> {
    const app = this.requireApp(name);
    app.planId = planId;
    this.rerun(app, `plan changed to ${planId}`);
  }

  async createDatabase(input: CreateDatabaseInput): Promise<{ id: string }> {
    const id = this.nextId("db");
    this.databases.push({ id, name: input.name, type: input.type, status: "RUNNING", planId: input.planId });
    return { id };
  }

  async createDisk(app: string, _name: string, _sizeGb: number): Promise<void> {
    this.requireApp(app);
  }

  // ── destructive ──────────────────────────────────────────────

  async deleteApp(name: string): Promise<void> {
    this.requireApp(name);
    this.apps.delete(name);
  }

  async setScale(name: string, scale: 0 | 1): Promise<void> {
    const app = this.requireApp(name);
    app.scale = scale;
    this.appendLogs(app, [`[system] app turned ${scale ? "on" : "off"}`]);
  }

  // ── mock-only: "break it on stage" ───────────────────────────

  /** Simulates an operator mistake. Returns the env key it touched. */
  breakApp(name: string, scenario: ChaosScenario): string {
    const app = this.requireApp(name);
    if (scenario === "wrong_port") {
      app.env.set("PORT", "8081");
      this.rerun(app, "env updated (PORT)");
      return "PORT";
    }
    const key = [...app.env.keys()].find((k) => k !== "PORT" && k !== "NODE_ENV");
    if (!key) throw new Error(`app "${name}" has no env var to remove`);
    app.env.delete(key);
    this.rerun(app, `env updated (${key} removed)`);
    return key;
  }
}
