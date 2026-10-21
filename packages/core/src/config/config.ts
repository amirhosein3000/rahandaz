/**
 * Runtime configuration, read once from the environment. Every safety switch
 * lives here so the policy layer, the console badges and the CLI agree.
 */
import fs from "node:fs";
import path from "node:path";

export interface LlmEndpoint {
  provider: "liara" | "openai-compatible";
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export interface RahandazConfig {
  /** "mock" uses MockLiaraClient; "real" talks to api.liara.ir. */
  liaraMode: "mock" | "real";
  mockLlm: boolean;
  /** Plan and show the exact calls, execute nothing that changes state. */
  dryRun: boolean;
  /** Destructive tools are unreachable unless this is true. */
  allowDestructive: boolean;
  /** Budget guard, in Toman per month. */
  maxMonthlyCostToman: number;
  /** Glob-ish app name patterns the agent may change (e.g. "rahandaz-*"). Reads are unrestricted. */
  allowedApps: string[];
  maxSteps: number;
  maxHealAttempts: number;
  /** LLM token budget per run (prompt + completion); the run stops when exceeded. */
  maxRunTokens: number;
  /** Default wall-clock limit for one tool call (tools that wait declare their own). */
  toolTimeoutMs: number;
  /** Agent models, in order of preference: the first is used, the next is the automatic fallback. */
  llms: LlmEndpoint[];
  embed: { baseUrl: string; apiKey: string; model: string } | null;
  liara: { apiToken: string; teamId: string; region: string; baseUrl: string };
  githubToken: string;
  rootDir: string;
  dataDir: string;
  fixturesDir: string;
  docsIndexDir: string;
  mockLatencyScale: number;
  chat: { botToken: string; apiBase: string; allowedChatIds: string[] };
}

const truthy = (v: string | undefined, dflt: boolean) => (v === undefined || v === "" ? dflt : /^(1|true|yes|on)$/i.test(v));
const num = (v: string | undefined, dflt: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : dflt;
};

/** Walk up from `start` to the monorepo root (the folder holding pnpm-workspace.yaml). */
export function findRootDir(start = process.cwd()): string {
  let dir = path.resolve(/*turbopackIgnore: true*/ start);
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(/*turbopackIgnore: true*/ start);
    dir = parent;
  }
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RahandazConfig {
  const rootDir = env.RAHANDAZ_ROOT ? path.resolve(env.RAHANDAZ_ROOT) : findRootDir();
  const liaraMode = env.LIARA_MODE === "real" ? "real" : "mock";
  // The spec allows Liara's services and credits, so Liara AI is a first-class option; the other
  // OpenAI-compatible provider is the automatic fallback (LLM_PROVIDER picks which goes first).
  const timeoutMs = num(env.LLM_TIMEOUT_MS, 60_000);
  const trimUrl = (u: string) => u.trim().replace(/\/$/, "");
  const liaraAi: LlmEndpoint | null =
    env.LIARA_AI_BASE_URL && env.LIARA_AI_KEY
      ? { provider: "liara", baseUrl: trimUrl(env.LIARA_AI_BASE_URL), apiKey: env.LIARA_AI_KEY, model: env.LIARA_AI_MODEL || "google/gemini-3.7-flash", timeoutMs }
      : null;
  const other: LlmEndpoint | null =
    env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_MODEL
      ? { provider: "openai-compatible", baseUrl: trimUrl(env.LLM_BASE_URL), apiKey: env.LLM_API_KEY, model: env.LLM_MODEL, timeoutMs }
      : null;
  const preferOther = env.LLM_PROVIDER === "openai-compatible" || env.LLM_PROVIDER === "openai";
  const llms = (preferOther ? [other, liaraAi] : [liaraAi, other]).filter((x): x is LlmEndpoint => x !== null);
  const mockLlm = truthy(env.MOCK_LLM, llms.length === 0);
  if (!mockLlm && llms.length === 0) {
    throw new ConfigError("MOCK_LLM=false needs a model: LIARA_AI_BASE_URL + LIARA_AI_KEY (Liara AI), or LLM_BASE_URL + LLM_API_KEY + LLM_MODEL.");
  }
  if (liaraMode === "real" && !env.LIARA_API_TOKEN) {
    throw new ConfigError("LIARA_MODE=real needs LIARA_API_TOKEN.");
  }

  const dataDir = path.resolve(rootDir, env.RAHANDAZ_DATA_DIR ?? "var");
  return {
    liaraMode,
    mockLlm,
    // Real mode is dry-run unless explicitly switched off.
    dryRun: truthy(env.DRY_RUN, liaraMode === "real"),
    allowDestructive: truthy(env.ALLOW_DESTRUCTIVE, false),
    maxMonthlyCostToman: num(env.MAX_MONTHLY_COST, 1_000_000),
    allowedApps: (env.ALLOWED_APPS ?? "*").split(",").map((s) => s.trim()).filter(Boolean),
    maxSteps: num(env.MAX_AGENT_STEPS, 40),
    maxHealAttempts: num(env.MAX_HEAL_ATTEMPTS, 3),
    maxRunTokens: num(env.MAX_RUN_TOKENS, 400_000),
    toolTimeoutMs: num(env.TOOL_TIMEOUT_MS, 180_000),
    llms,
    embed:
      env.EMBED_BASE_URL && env.EMBED_API_KEY
        ? { baseUrl: env.EMBED_BASE_URL.replace(/\/$/, ""), apiKey: env.EMBED_API_KEY, model: env.EMBED_MODEL ?? "text-embedding-3-small" }
        : null,
    liara: {
      apiToken: env.LIARA_API_TOKEN ?? "",
      teamId: env.LIARA_TEAM_ID ?? "",
      region: env.LIARA_REGION ?? "iran",
      baseUrl: env.LIARA_API_BASE_URL ?? "https://api.liara.ir",
    },
    githubToken: env.GITHUB_TOKEN ?? "",
    rootDir,
    dataDir,
    fixturesDir: path.join(rootDir, "fixtures"),
    docsIndexDir: path.resolve(rootDir, env.DOCS_INDEX_DIR ?? "data/liara-docs"),
    mockLatencyScale: num(env.MOCK_LATENCY_SCALE, 1),
    chat: {
      botToken: env.CHAT_BOT_TOKEN ?? "",
      apiBase: (env.CHAT_BOT_API_BASE ?? "https://tapi.bale.ai").replace(/\/$/, ""),
      allowedChatIds: (env.CHAT_ALLOWED_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    },
  };
}

/** Values that must never appear in any output. Registered with the redactor at startup. */
export function configSecrets(cfg: RahandazConfig): string[] {
  return [...cfg.llms.map((l) => l.apiKey), cfg.liara.apiToken, cfg.githubToken, cfg.embed?.apiKey ?? "", cfg.chat.botToken].filter((s) => s.length >= 6);
}

export function appAllowed(cfg: Pick<RahandazConfig, "allowedApps">, app: string): boolean {
  return cfg.allowedApps.some((pattern) => {
    if (pattern === "*") return true;
    const re = new RegExp("^" + pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
    return re.test(app);
  });
}
