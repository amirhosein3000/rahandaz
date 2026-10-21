import type {
  Account,
  AppDetails,
  AppLogLine,
  BuildLogLine,
  CreateAppInput,
  CreateDatabaseInput,
  DatabaseInfo,
  DeployInput,
  DiskInfo,
  DnsRecord,
  DnsZone,
  DomainInfo,
  EnvVarWrite,
  HealthResult,
  LiaraApp,
  MetricsSummary,
  Plan,
  Release,
} from "./types";

/**
 * Everything the agent can do on Liara. Two implementations:
 * `RealLiaraClient` (REST, docs/liara-api/NOTES.md) and `MockLiaraClient`
 * (in-memory, simulates builds from the actual source tree).
 *
 * The client is deliberately policy-free: approvals, DRY_RUN and
 * ALLOW_DESTRUCTIVE are enforced by the tool executor in @rahandaz/core,
 * which is the only caller of the mutating methods.
 */
export interface LiaraClient {
  readonly mode: "real" | "mock";

  // ── read-only ────────────────────────────────────────────────
  whoami(): Promise<Account>;
  listApps(): Promise<LiaraApp[]>;
  getApp(name: string): Promise<AppDetails | null>;
  getRelease(app: string, releaseId: string): Promise<Release>;
  /** Most recent releases first (spec: GET /v1/projects/{name}/releases). */
  listReleases(app: string): Promise<Release[]>;
  /** Build output after the `since` cursor (exclusive). */
  getBuildLogs(releaseId: string, since?: string): Promise<BuildLogLine[]>;
  /** Runtime logs since a unix timestamp (seconds). */
  getAppLogs(app: string, sinceUnix: number): Promise<AppLogLine[]>;
  getMetrics(app: string): Promise<MetricsSummary>;
  listPlans(): Promise<Plan[]>;
  listDatabases(): Promise<DatabaseInfo[]>;
  listDisks(app: string): Promise<DiskInfo[]>;
  /** Domains attached to an app (spec: GET /v1/domains?project=). */
  listDomains(app: string): Promise<DomainInfo[]>;
  /** Details incl. the DNS values to set (spec: GET /v1/domains/{id}/check). */
  checkDomain(id: string): Promise<DomainInfo>;
  /** Zone on Liara DNS, or null when the domain is not managed there (dns.yaml: GET /api/v1/zones/{zone}). */
  getDnsZone(zone: string): Promise<DnsZone | null>;
  listDnsRecords(zone: string): Promise<DnsRecord[]>;
  appUrl(app: string): string;
  checkHealth(app: string, path?: string): Promise<HealthResult>;

  // ── mutating ─────────────────────────────────────────────────
  createApp(input: CreateAppInput): Promise<void>;
  setEnvVars(app: string, vars: EnvVarWrite[]): Promise<void>;
  deploy(input: DeployInput): Promise<{ releaseId: string }>;
  restartApp(app: string): Promise<void>;
  resizeApp(app: string, planId: string): Promise<void>;
  createDatabase(input: CreateDatabaseInput): Promise<{ id: string }>;
  createDisk(app: string, name: string, sizeGb: number): Promise<void>;
  /** Attach a new domain to an app (spec: POST /v1/domains). */
  addDomain(app: string, domain: string): Promise<{ id: string }>;
  /** Issue a free SSL certificate (spec: POST /v1/domains/provision-ssl-certs). */
  enableSsl(domain: string): Promise<void>;
  createDnsZone(zone: string): Promise<DnsZone>;
  createDnsRecord(zone: string, record: DnsRecord): Promise<void>;

  // ── destructive (gated by ALLOW_DESTRUCTIVE + named confirmation) ─────
  deleteApp(app: string): Promise<void>;
  setScale(app: string, scale: 0 | 1): Promise<void>;
}

export class LiaraApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LiaraApiError";
  }
}
