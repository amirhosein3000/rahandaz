/**
 * REST implementation of LiaraClient. Every path here is listed, with its
 * source (spec / CLI-SOURCE), in docs/liara-api/NOTES.md.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LiaraApiError, type LiaraClient } from "../client";
import { FALLBACK_PLANS } from "../plans";
import { LiaraRequests } from "../requests";
import { createSourceArchive } from "./archive";
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
  PlannedCall,
  Release,
  ReleaseState,
} from "../types";

export interface RealLiaraClientOptions {
  apiToken: string;
  teamId?: string;
  /** Default https://api.liara.ir (spec `servers`). */
  baseUrl?: string;
  /** Default `https://{app}.liara.run` (UNVERIFIED: docs convention, not in the spec). */
  appUrlTemplate?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

type Json = Record<string, unknown>;

const RELEASE_STATES = new Set<ReleaseState>([
  "QUEUED",
  "BUILDING",
  "PUSHING",
  "PUSHED",
  "DEPLOYING",
  "READY",
  "FAILED",
  "UNHEALTHY",
  "CANCELED",
  "TIMEDOUT",
]);

export class RealLiaraClient implements LiaraClient {
  readonly mode = "real" as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: RealLiaraClientOptions) {
    if (!opts.apiToken) throw new Error("LIARA_API_TOKEN is required for the real Liara client");
    this.baseUrl = (opts.baseUrl ?? "https://api.liara.ir").replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  // ── transport ────────────────────────────────────────────────

  private async request<T = Json>(
    method: PlannedCall["method"],
    pathAndQuery: string,
    init: { json?: unknown; form?: FormData; timeoutMs?: number } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + pathAndQuery);
    // Team scoping, as the CLI does it (empty = personal account).
    url.searchParams.set("teamID", this.opts.teamId ?? "");

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.apiToken}`,
      Accept: "application/json",
      "User-Agent": "rahandaz/0.1",
    };
    let body: string | FormData | undefined;
    if (init.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.json);
    } else if (init.form) {
      body = init.form;
    }

    // Only idempotent reads are retried; a retried POST could double-apply.
    const attempts = method === "GET" ? 3 : 1;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const res = await this.fetchImpl(url, {
          method,
          headers,
          body,
          signal: AbortSignal.timeout(init.timeoutMs ?? this.opts.timeoutMs ?? 20_000),
        });
        if (res.ok) {
          const text = await res.text();
          return (text ? JSON.parse(text) : {}) as T;
        }
        const retryable = res.status === 429 || res.status >= 500;
        // Never include the response body verbatim: it may echo request data.
        const err = new LiaraApiError(`Liara API ${method} ${pathAndQuery.split("?")[0]} → HTTP ${res.status}`, res.status, pathAndQuery, retryable);
        if (!retryable || attempt === attempts) throw err;
        lastErr = err;
      } catch (err) {
        if (err instanceof LiaraApiError && !err.retryable) throw err;
        lastErr = err;
        if (attempt === attempts) break;
      }
      await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));
    }
    if (lastErr instanceof LiaraApiError) throw lastErr;
    throw new LiaraApiError(
      `Liara API ${method} ${pathAndQuery.split("?")[0]} failed: ${(lastErr as Error)?.message ?? "network error"}`,
      0,
      pathAndQuery,
      true,
    );
  }

  private send<T = Json>(call: PlannedCall): Promise<T> {
    return this.request<T>(call.method, call.path, call.body === undefined ? {} : { json: call.body });
  }

  // ── read-only ────────────────────────────────────────────────

  async whoami(): Promise<Account> {
    const me = await this.request<{ user?: { email?: string; fullname?: string } }>("GET", "/v1/me");
    return { email: me.user?.email, fullname: me.user?.fullname, teamId: this.opts.teamId };
  }

  async listApps(): Promise<LiaraApp[]> {
    const data = await this.request<{ projects?: Json[] }>("GET", "/v1/projects");
    return (data.projects ?? []).map((p) => toApp(p));
  }

  async getApp(name: string): Promise<AppDetails | null> {
    let data: { project?: Json };
    try {
      data = await this.request("GET", `/v1/projects/${encodeURIComponent(name)}`);
    } catch (err) {
      if (err instanceof LiaraApiError && err.status === 404) return null;
      throw err;
    }
    if (!data.project) return null;
    const p = data.project;
    const envs = Array.isArray(p.envs) ? (p.envs as Array<{ key?: string }>) : [];
    return {
      ...toApp(p),
      // Values are dropped here, at the edge: they never enter our process memory beyond this line.
      envKeys: envs.map((e) => String(e.key ?? "")).filter(Boolean),
      url: this.appUrl(name),
    };
  }

  async getRelease(app: string, releaseId: string): Promise<Release> {
    const data = await this.request<{ release?: Json }>("GET", `/v1/releases/${encodeURIComponent(releaseId)}`);
    const r = data.release ?? {};
    const state = String(r.state ?? "QUEUED").toUpperCase() as ReleaseState;
    return {
      id: releaseId,
      app,
      state: RELEASE_STATES.has(state) ? state : "BUILDING",
      failReason: typeof r.failReason === "string" ? r.failReason : undefined,
      port: typeof r.port === "number" ? r.port : undefined,
      createdAt: String(r.createdAt ?? new Date().toISOString()),
    };
  }

  async getBuildLogs(releaseId: string, since?: string): Promise<BuildLogLine[]> {
    const q = since ? `?since=${encodeURIComponent(since)}` : "";
    const data = await this.request<{ buildOutput?: Json[] }>("GET", `/v2/releases/${encodeURIComponent(releaseId)}/build-logs${q}`);
    return (data.buildOutput ?? []).map((o) => ({
      stream: o.stream === "STDOUT" ? "STDOUT" : "STDERR",
      line: String(o.line ?? ""),
      createdAt: String(o.createdAt ?? ""),
    }));
  }

  async getAppLogs(app: string, sinceUnix: number): Promise<AppLogLine[]> {
    const data = await this.request<unknown>("GET", `/v1/projects/${encodeURIComponent(app)}/logs?since=${sinceUnix}`);
    const rows = Array.isArray(data) ? (data as Json[]) : [];
    return rows.map((r) => ({
      ts: String(r.datetime ?? ""),
      type: String(r.type ?? "stdout"),
      message: String(r.message ?? ""),
    }));
  }

  async getMetrics(app: string): Promise<MetricsSummary> {
    const data = await this.request<{ cpuUsage?: Array<{ value?: unknown[] }>; memoryUsage?: Array<{ value?: unknown[] }> }>(
      "GET",
      `/v1/projects/${encodeURIComponent(app)}/metrics/summary`,
    );
    // `value` is a Prometheus-style [timestamp, "number"] pair (spec: oneOf number|string). Units UNVERIFIED.
    const last = (series?: Array<{ value?: unknown[] }>) => {
      const v = series?.[0]?.value?.[1];
      const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
      return Number.isFinite(n) ? n : null;
    };
    const mem = last(data.memoryUsage);
    return {
      cpuPercent: last(data.cpuUsage),
      memoryMb: mem === null ? null : Math.round(mem / (1024 * 1024)),
      memoryLimitMb: null,
      restarts: null,
      responseMsP50: null,
    };
  }

  async listPlans(): Promise<Plan[]> {
    // The catalogue shape inside `plans.projects` is untyped in the spec (UNVERIFIED).
    // Accept it only when every entry has the fields we need; otherwise use the fallback table.
    try {
      const me = await this.request<{ plans?: { projects?: Record<string, Json> } }>("GET", "/v1/me");
      const raw = me.plans?.projects;
      if (!raw || typeof raw !== "object") return FALLBACK_PLANS;
      const plans: Plan[] = [];
      for (const [id, p] of Object.entries(raw)) {
        const ram = Number((p.RAM as Json | undefined)?.amount ?? p.ram);
        const cpu = Number((p.CPU as Json | undefined)?.amount ?? p.cpu);
        const price = Number(p.price ?? p.monthlyPrice);
        if (!Number.isFinite(ram) || !Number.isFinite(cpu) || !Number.isFinite(price)) return FALLBACK_PLANS;
        plans.push({
          id,
          labelFa: String(p.name ?? id),
          cpu,
          ramMb: ram < 64 ? Math.round(ram * 1024) : ram,
          diskGb: Number((p.volume as number | undefined) ?? 0),
          monthlyToman: price,
          verified: true,
        });
      }
      return plans.length ? plans : FALLBACK_PLANS;
    } catch {
      return FALLBACK_PLANS;
    }
  }

  async listDatabases(): Promise<DatabaseInfo[]> {
    const data = await this.request<{ databases?: Json[] }>("GET", "/v1/databases");
    return (data.databases ?? []).map((d) => ({
      id: String(d._id ?? ""),
      name: String(d.hostname ?? d.name ?? ""),
      type: String(d.type ?? ""),
      status: String(d.status ?? ""),
      planId: String(d.planID ?? ""),
    }));
  }

  async listDisks(app: string): Promise<DiskInfo[]> {
    const data = await this.request<{ disks?: Json[]; mounts?: Json[] }>("GET", `/v1/projects/${encodeURIComponent(app)}/disks`);
    const mounts = new Map((data.mounts ?? []).map((m) => [String(m.name), String(m.mountedTo ?? "")]));
    return (data.disks ?? []).map((d) => ({
      name: String(d.name ?? ""),
      sizeGb: Number(d.size ?? 0),
      mountedTo: mounts.get(String(d.name)),
    }));
  }

  async listDomains(): Promise<DomainInfo[]> {
    const data = await this.request<{ domains?: Json[] }>("GET", "/v1/domains");
    return (data.domains ?? []).map((d) => ({
      name: String(d.name ?? ""),
      app: String((d.project as Json | undefined)?.project_id ?? "") || undefined,
      status: String(d.status ?? ""),
    }));
  }

  appUrl(app: string): string {
    return (this.opts.appUrlTemplate ?? "https://{app}.liara.run").replace("{app}", app);
  }

  async checkHealth(app: string, healthPath = "/"): Promise<HealthResult> {
    const url = new URL(healthPath, this.appUrl(app)).toString();
    const t0 = Date.now();
    try {
      const res = await this.fetchImpl(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(10_000) });
      return { ok: res.status < 500, url, status: res.status, latencyMs: Date.now() - t0 };
    } catch (err) {
      return { ok: false, url, latencyMs: Date.now() - t0, error: (err as Error).message };
    }
  }

  // ── mutating ─────────────────────────────────────────────────

  async createApp(input: CreateAppInput): Promise<void> {
    await this.send(LiaraRequests.createApp(input));
  }

  async setEnvVars(app: string, vars: EnvVarWrite[]): Promise<void> {
    const call = LiaraRequests.updateEnvs(
      app,
      vars.map((v) => v.key),
    );
    // Same path/shape as the planned call, with the real values substituted only here.
    await this.request("POST", call.path, { json: { project: app, variables: vars.map((v) => ({ key: v.key, value: v.value })) } });
  }

  async deploy(input: DeployInput): Promise<{ releaseId: string }> {
    const [uploadCall, releaseCall] = LiaraRequests.deploy(input);
    const tmp = path.join(os.tmpdir(), `rahandaz-src-${Date.now()}.tar.gz`);
    try {
      await createSourceArchive(input.sourceDir, tmp);
      const form = new FormData();
      form.append("file", new Blob([fs.readFileSync(tmp)]), "source.tar.gz");
      const up = await this.request<{ sourceID?: string }>("POST", uploadCall!.path, { form, timeoutMs: 300_000 });
      if (!up.sourceID) throw new LiaraApiError("Upload succeeded but no sourceID was returned", 200, uploadCall!.path, false);
      const rel = await this.request<{ releaseID?: string }>("POST", releaseCall!.path, {
        json: { sourceID: up.sourceID, port: input.port, type: input.platform },
      });
      if (!rel.releaseID) throw new LiaraApiError("Release created but no releaseID was returned", 200, releaseCall!.path, false);
      return { releaseId: rel.releaseID };
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  async restartApp(app: string): Promise<void> {
    await this.send(LiaraRequests.restart(app));
  }

  async resizeApp(app: string, planId: string): Promise<void> {
    await this.send(LiaraRequests.resize(app, planId));
  }

  async createDatabase(input: CreateDatabaseInput): Promise<{ id: string }> {
    const data = await this.send<{ databaseID?: string }>(LiaraRequests.createDatabase(input));
    return { id: String(data.databaseID ?? "") };
  }

  async createDisk(app: string, name: string, sizeGb: number): Promise<void> {
    await this.send(LiaraRequests.createDisk(app, name, sizeGb));
  }

  // ── destructive ──────────────────────────────────────────────

  async deleteApp(app: string): Promise<void> {
    await this.send(LiaraRequests.deleteApp(app));
  }

  async setScale(app: string, scale: 0 | 1): Promise<void> {
    await this.send(LiaraRequests.scale(app, scale));
  }
}

function toApp(p: Json): LiaraApp {
  return {
    name: String(p.project_id ?? ""),
    id: String(p._id ?? ""),
    platform: String(p.type ?? ""),
    status: mapStatus(String(p.status ?? ""), Number(p.scale ?? 1), Boolean(p.isDeployed)),
    planId: String(p.planID ?? ""),
    scale: Number(p.scale ?? 1),
    isDeployed: Boolean(p.isDeployed),
    createdAt: String(p.created_at ?? ""),
  };
}

/** Liara's status vocabulary is not enumerated in the spec (UNVERIFIED); map defensively. */
function mapStatus(raw: string, scale: number, isDeployed: boolean): AppStatus {
  if (!isDeployed) return "not_deployed";
  if (scale === 0) return "stopped";
  const s = raw.toLowerCase();
  if (s.includes("deploy") || s.includes("build")) return "deploying";
  if (s.includes("crash") || s.includes("fail") || s.includes("error")) return "crashed";
  if (s.includes("off") || s.includes("stop")) return "stopped";
  if (s) return "running";
  return "unknown";
}
