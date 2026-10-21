/**
 * Domain types for talking to Liara. Field names are ours (camelCase, stable);
 * `real/rest.ts` maps the API's shapes (see docs/liara-api/NOTES.md) onto them.
 */

/** Platforms accepted by Liara (`AVAILABLE_PLATFORMS` in @liara/cli 9.6.0). */
export const PLATFORMS = [
  "node",
  "next",
  "laravel",
  "php",
  "python",
  "django",
  "flask",
  "go",
  "docker",
  "static",
  "react",
  "vue",
  "angular",
  "dotnet",
] as const;
export type Platform = (typeof PLATFORMS)[number];

export type AppStatus = "running" | "stopped" | "crashed" | "deploying" | "not_deployed" | "unknown";

export interface LiaraApp {
  /** Liara calls this `project_id`; it is the human name used in URLs. */
  name: string;
  id: string;
  platform: string;
  status: AppStatus;
  planId: string;
  /** 1 = on, 0 = off. */
  scale: number;
  isDeployed: boolean;
  createdAt: string;
}

export interface AppDetails extends LiaraApp {
  /** Env var NAMES only. Values never leave the Liara client. */
  envKeys: string[];
  /** Port of the current release, when known. */
  port?: number;
  url: string;
}

/** A write-only env var. `value` is resolved from the secret vault right before the API call. */
export interface EnvVarWrite {
  key: string;
  value: string;
}

export type ReleaseState =
  | "QUEUED"
  | "BUILDING"
  | "PUSHING"
  | "PUSHED"
  | "DEPLOYING"
  | "READY"
  | "FAILED"
  | "UNHEALTHY"
  | "CANCELED"
  | "TIMEDOUT";

export const TERMINAL_RELEASE_STATES: ReadonlySet<ReleaseState> = new Set([
  "READY",
  "FAILED",
  "UNHEALTHY",
  "CANCELED",
  "TIMEDOUT",
]);

export interface Release {
  id: string;
  app: string;
  state: ReleaseState;
  failReason?: string;
  port?: number;
  createdAt: string;
}

export interface BuildLogLine {
  stream: "STDOUT" | "STDERR";
  line: string;
  /** Opaque cursor; pass the last one back as `since`. */
  createdAt: string;
}

export interface AppLogLine {
  ts: string;
  /** stdout | stderr | system */
  type: string;
  message: string;
}

export interface MetricsSummary {
  cpuPercent: number | null;
  memoryMb: number | null;
  memoryLimitMb: number | null;
  /** Restarts in the observed window, when derivable. */
  restarts: number | null;
  /** p50 response time in ms, when the source can tell. Liara's API does not expose this (UNVERIFIED). */
  responseMsP50: number | null;
}

export interface Plan {
  id: string;
  labelFa: string;
  cpu: number;
  ramMb: number;
  diskGb: number;
  /** Monthly price in Toman. */
  monthlyToman: number;
  /** False when the number comes from our placeholder table instead of Liara. */
  verified: boolean;
}

export interface DatabaseInfo {
  id: string;
  name: string;
  type: string;
  status: string;
  planId: string;
}

export interface DiskInfo {
  name: string;
  sizeGb: number;
  mountedTo?: string;
}

export interface DomainInfo {
  name: string;
  app?: string;
  status: string;
}

export interface HealthResult {
  ok: boolean;
  url: string;
  status?: number;
  latencyMs?: number;
  error?: string;
}

export interface Account {
  email?: string;
  fullname?: string;
  teamId?: string;
}

export interface CreateAppInput {
  name: string;
  platform: string;
  planId: string;
}

export interface DeployInput {
  app: string;
  /** Absolute path of the source directory to upload. */
  sourceDir: string;
  port: number;
  platform: string;
}

export interface CreateDatabaseInput {
  name: string;
  type: string;
  planId: string;
}

/** One HTTP request as it would be sent; used for DRY_RUN and approval cards. */
export interface PlannedCall {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  /** Body with secret values already replaced by placeholders. */
  body?: unknown;
  note?: string;
}
