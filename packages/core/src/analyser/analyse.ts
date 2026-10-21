/**
 * Deterministic repo analyser. Reads files, never executes anything from the
 * repo. Detectors run in a fixed order (mirroring @liara/cli's
 * `detect-platform`); the LLM is only used later, to explain gaps.
 *
 * Policy: report facts and risks, never silently "fix" the user's declared
 * config (liara.json, .env.example). Risks surface as warnings on the plan.
 */
import fs from "node:fs";
import path from "node:path";
import type { Platform } from "@rahandaz/liara";
import { scanForInjection } from "../safety/untrusted";
import type { AnalysisWarning, EnvVarNeed, RepoAnalysis, SuggestedRef } from "./types";

type Files = Map<string, string>;

const IGNORED_DIRS = new Set([".git", "node_modules", ".next", "vendor", "__pycache__", ".venv", "venv", "dist", "build", "coverage"]);
const MAX_FILES = 2000;
const MAX_BYTES = 256_000;

/** Liara's default port per platform (@liara/cli `utils/get-port.js`). */
export function defaultPortFor(platform: Platform): number {
  const p80: Platform[] = ["static", "python", "react", "vue", "angular", "laravel", "django", "flask", "php", "dotnet"];
  if (p80.includes(platform)) return 80;
  if (platform === "go") return 8080;
  return 3000;
}

/** Env vars the platform or runtime provides; never ask the user for them. */
const RUNTIME_ENV = new Set(["PORT", "NODE_ENV", "HOSTNAME", "HOST", "PATH", "HOME", "PWD", "CI", "TZ", "NEXT_RUNTIME", "VERCEL", "DEBUG"]);

const OFFICIAL_IMAGES = new Set(["node", "python", "php", "golang", "nginx", "alpine", "ubuntu", "debian", "httpd", "caddy", "eclipse-temurin", "openjdk", "ruby", "rust", "denoland/deno", "oven/bun", "composer"]);

export function readRepoFiles(root: string): Files {
  const files: Files = new Map();
  const walk = (dir: string) => {
    if (files.size >= MAX_FILES) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && fs.statSync(abs).size <= MAX_BYTES && isTextName(entry.name)) {
        files.set(path.relative(root, abs).split(path.sep).join("/"), fs.readFileSync(abs, "utf8"));
      }
    }
  };
  walk(root);
  return files;
}

function isTextName(name: string): boolean {
  return /\.(m?[jt]sx?|cjs|json|py|php|txt|toml|cfg|ini|go|mod|ya?ml|md|example|lock|html|conf|env)$/i.test(name) ||
    ["Dockerfile", "Procfile", "artisan", "requirements.txt", "go.mod", "Pipfile"].includes(name) ||
    name.startsWith(".env");
}

export function analyseRepo(root: string): RepoAnalysis {
  return analyseFiles(readRepoFiles(root));
}

export function analyseFiles(files: Files): RepoAnalysis {
  const fired: string[] = [];
  const warnings: AnalysisWarning[] = [];
  const pkg = parseJson<{ scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; main?: string }>(files.get("package.json"));
  const composer = parseJson<{ require?: Record<string, string> }>(files.get("composer.json"));
  const liaraRaw = parseJson<Record<string, unknown>>(files.get("liara.json"));
  const liaraJson = liaraRaw
    ? {
        platform: typeof liaraRaw.platform === "string" ? liaraRaw.platform : undefined,
        port: typeof liaraRaw.port === "number" ? liaraRaw.port : undefined,
        app: typeof liaraRaw.app === "string" ? liaraRaw.app : undefined,
      }
    : null;
  if (liaraJson) fired.push("liara.json");

  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const requirements = files.get("requirements.txt");

  // ── platform ────────────────────────────────────────────────
  let platform: Platform;
  let framework: string | null = null;
  let language: RepoAnalysis["language"] = "other";
  if (liaraJson?.platform && isPlatform(liaraJson.platform)) {
    platform = liaraJson.platform;
  } else if (files.has("Dockerfile")) {
    platform = "docker";
  } else if (composer) {
    platform = composer.require?.["laravel/framework"] || composer.require?.["laravel/lumen-framework"] ? "laravel" : "php";
  } else if (requirements || files.has("pyproject.toml") || files.has("Pipfile")) {
    const req = (requirements ?? "").toLowerCase();
    platform = req.includes("django") ? "django" : req.includes("flask") ? "flask" : "python";
  } else if (files.has("go.mod")) {
    platform = "go";
  } else if (pkg) {
    platform = deps.next ? "next" : "node";
  } else if (files.has("index.html")) {
    platform = "static";
  } else {
    platform = "node";
  }
  fired.push(`platform:${platform}`);

  if (pkg) language = Object.keys(deps).includes("typescript") || [...files.keys()].some((f) => f.endsWith(".ts")) ? "typescript" : "javascript";
  if (requirements || platform === "django" || platform === "flask" || platform === "python") language = "python";
  if (composer) language = "php";
  if (files.has("go.mod")) language = "go";

  if (deps.next) framework = `Next.js ${String(deps.next).replace(/[^\d.]/g, "").split(".")[0] ?? ""}`.trim();
  else if (deps.express) framework = "Express";
  else if (platform === "flask") framework = "Flask";
  else if (platform === "django") framework = "Django";
  else if (platform === "laravel") framework = "Laravel";

  // ── port ───────────────────────────────────────────────────
  const portEvidence: string[] = [];
  const codePort = detectCodePort(files);
  if (codePort) portEvidence.push(`${codePort.file}: ${codePort.snippet}`);
  const exposed = Number(files.get("Dockerfile")?.match(/^\s*EXPOSE\s+(\d+)/im)?.[1] ?? NaN);
  const procfileBind = Number(files.get("Procfile")?.match(/--bind\s+[\d.]*:(\d+)/)?.[1] ?? NaN);

  let port: number;
  let portSource: RepoAnalysis["portSource"];
  if (liaraJson?.port) {
    port = liaraJson.port;
    portSource = "liara.json";
    portEvidence.unshift(`liara.json: "port": ${port}`);
  } else if (platform === "docker" && Number.isFinite(exposed)) {
    port = exposed;
    portSource = "Dockerfile";
    portEvidence.unshift(`Dockerfile: EXPOSE ${exposed}`);
  } else if (Number.isFinite(procfileBind)) {
    port = procfileBind;
    portSource = "Procfile";
  } else if (codePort && (platform === "node" || platform === "go")) {
    port = codePort.port;
    portSource = "code";
  } else {
    port = defaultPortFor(platform);
    portSource = "platform-default";
  }
  if (codePort && codePort.port !== port && !codePort.readsEnv && (platform === "node" || platform === "docker")) {
    warnings.push({
      code: "port_conflict",
      file: codePort.file,
      messageFa: `پورت اعلام‌شده ${port} است ولی کد روی ${codePort.port} گوش می‌دهد (${codePort.file}). اگر یکی نشوند، health check شکست می‌خورد.`,
    });
  }

  // ── commands ───────────────────────────────────────────────
  let buildCommand: string | null = null;
  let startCommand: string | null = null;
  if (pkg) {
    buildCommand = pkg.scripts?.build ? "npm run build" : null;
    startCommand = pkg.scripts?.start ? "npm start" : null;
    if (!pkg.scripts?.start && platform !== "docker") {
      warnings.push({ code: "no_start_script", file: "package.json", messageFa: "در package.json اسکریپت start وجود ندارد؛ لیارا برنامه‌ی Node را با npm start اجرا می‌کند." });
    }
    if (!files.has("package-lock.json") && !files.has("pnpm-lock.yaml") && !files.has("yarn.lock")) {
      warnings.push({ code: "no_lockfile", file: "package.json", messageFa: "فایل lock وجود ندارد؛ نسخه‌ی وابستگی‌ها در هر بیلد ممکن است فرق کند." });
    }
  }
  if (files.get("Procfile")) startCommand = files.get("Procfile")!.replace(/^web:\s*/m, "").trim().split("\n")[0] ?? null;

  if (requirements) {
    const unpinned = requirements
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*/, "").trim())
      .filter((l) => l && !l.startsWith("-") && !/==/.test(l))
      .map((l) => l.split(/[<>=!~ ;[]/)[0]!);
    if (unpinned.length) {
      warnings.push({
        code: "unpinned_dependencies",
        file: "requirements.txt",
        messageFa: `این وابستگی‌ها نسخه‌ی ثابت ندارند: ${unpinned.join("، ")}. ممکن است نسخه‌ی جدید و ناسازگار نصب شود.`,
      });
    }
  }

  for (const m of (files.get("Dockerfile") ?? "").matchAll(/^\s*FROM\s+([^\s]+)/gim)) {
    const image = m[1]!.split(":")[0]!.replace(/^docker\.io\/(library\/)?/, "");
    if (!OFFICIAL_IMAGES.has(image) && !image.includes("/")) {
      warnings.push({ code: "unknown_base_image", file: "Dockerfile", messageFa: `ایمیج پایه‌ی «${m[1]}» جزو ایمیج‌های رسمی شناخته‌شده نیست؛ ممکن است وجود نداشته باشد.` });
    }
  }

  for (const f of files.keys()) {
    if (/(^|\/)\.env(\.(local|production|prod))?$/.test(f)) {
      warnings.push({ code: "secret_file_committed", file: f, messageFa: `فایل ${f} در مخزن است؛ احتمالاً رمزها لو رفته‌اند. ما آن را آپلود نمی‌کنیم.` });
    }
  }

  // ── env vars, database, disk ───────────────────────────────
  const env = detectEnv(files, platform);
  const database = detectDatabase(files, deps, requirements ?? "");
  const disk = detectDisk(files, deps);

  // ── untrusted instructions ─────────────────────────────────
  const injection: RepoAnalysis["injection"] = [];
  for (const [file, text] of files) {
    const findings = scanForInjection(text);
    if (findings.length) injection.push({ file, findings });
  }
  if (injection.length) {
    warnings.push({
      code: "injection_text",
      file: injection[0]!.file,
      messageFa: `در ${injection.map((i) => i.file).join("، ")} متنی شبیه دستور به هوش مصنوعی پیدا شد. آن را دستور حساب نمی‌کنیم و فقط داده است.`,
    });
  }

  const stackLabel = framework ?? ({ node: "Node.js", python: "Python", php: "PHP", go: "Go", docker: "Docker", static: "Static" } as Record<string, string>)[platform] ?? platform;

  return {
    stackLabel,
    platform,
    language,
    framework,
    port,
    portSource,
    portEvidence,
    buildCommand,
    startCommand,
    env,
    database,
    disk,
    liaraJson,
    warnings,
    injection,
    filesScanned: files.size,
    detectorsFired: fired,
  };
}

function detectCodePort(files: Files): { port: number; file: string; snippet: string; readsEnv: boolean } | null {
  for (const [file, src] of files) {
    if (!/\.(m?[jt]s|cjs|go)$/.test(file) || file.includes("node_modules")) continue;
    const env = src.match(/process\.env\.PORT\s*(?:\|\||\?\?)\s*(\d{2,5})/);
    if (env) return { port: Number(env[1]), file, snippet: env[0], readsEnv: true };
    const lit = src.match(/\.listen\(\s*(\d{2,5})/);
    if (lit) return { port: Number(lit[1]), file, snippet: lit[0], readsEnv: false };
    const goPort = src.match(/ListenAndServe\(\s*"[^"]*:(\d{2,5})"/);
    if (goPort) return { port: Number(goPort[1]), file, snippet: goPort[0], readsEnv: false };
  }
  return null;
}

function detectEnv(files: Files, platform: Platform): EnvVarNeed[] {
  const found = new Map<string, EnvVarNeed>();
  const withExample = new Set<string>();
  const add = (name: string, source: string) => {
    if (RUNTIME_ENV.has(name) || found.has(name)) return;
    const secret = isSecretName(name);
    let suggestedRef = suggestRef(name, platform);
    // A non-secret key with a non-empty example value (APP_ENV=production) defaults to that value.
    if (suggestedRef === "user" && !secret && withExample.has(name)) suggestedRef = "example";
    found.set(name, { name, source, secret, suggestedRef });
  };
  const example = files.get(".env.example") ?? files.get(".env.sample") ?? files.get("env.example");
  if (example) {
    const lines = example.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(\S?)/i);
      if (m?.[2] && m[2] !== "#") withExample.add(m[1]!);
    }
    for (const line of lines) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/i);
      // Only the NAME (and whether an example value exists) is kept; values never enter the analysis.
      if (m) add(m[1]!, ".env.example");
    }
  }
  for (const [file, src] of files) {
    if (/\.(m?[jt]sx?|cjs)$/.test(file)) {
      for (const m of src.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) add(m[1]!, file);
    } else if (file.endsWith(".py")) {
      for (const m of src.matchAll(/os\.(?:environ(?:\.get)?\(|environ\[|getenv\()\s*["']([A-Z_][A-Z0-9_]*)["']/g)) add(m[1]!, file);
    } else if (file.endsWith(".go")) {
      for (const m of src.matchAll(/os\.Getenv\(\s*"([A-Z_][A-Z0-9_]*)"/g)) add(m[1]!, file);
    }
  }
  // Laravel: config files call env('NAME'); only APP_* / DB_* that the repo itself lists are needed,
  // the rest have defaults. We do not invent APP_KEY: if the repo doesn't declare it we don't either.
  return [...found.values()];
}

function isSecretName(name: string): boolean {
  return /(SECRET|TOKEN|PASSWORD|PASS|_KEY$|^KEY$|PRIVATE|CREDENTIAL|DSN|DATABASE_URL|_URI$|SALT)/i.test(name);
}

function suggestRef(name: string, platform: Platform): SuggestedRef {
  if (name === "APP_KEY" && platform === "laravel") return "generate:laravel_app_key";
  if (/^(SESSION_SECRET|COOKIE_SECRET|JWT_SECRET|SECRET_KEY|APP_SECRET|NEXTAUTH_SECRET|AUTH_SECRET)$/.test(name)) return "generate:secret";
  return "user";
}

function detectDatabase(files: Files, deps: Record<string, string>, requirements: string): RepoAnalysis["database"] {
  const req = requirements.toLowerCase();
  const pick = (kind: string, evidence: string) => ({ needed: true, kind, evidence });
  if (deps.pg || deps.postgres || req.includes("psycopg")) return pick("postgres", deps.pg ? "package.json: pg" : "requirements: psycopg");
  if (deps.mysql2 || deps.mysql || req.includes("pymysql") || req.includes("mysqlclient")) return pick("mysql", "mysql driver in dependencies");
  if (deps.mongoose || deps.mongodb || req.includes("pymongo")) return pick("mongodb", "mongo driver in dependencies");
  const prisma = files.get("prisma/schema.prisma");
  const provider = prisma?.match(/provider\s*=\s*"(postgresql|mysql|mongodb|sqlite)"/)?.[1];
  if (provider && provider !== "sqlite") return pick(provider === "postgresql" ? "postgres" : provider, "prisma/schema.prisma");
  if (deps.redis || deps.ioredis || req.includes("redis")) return pick("redis", "redis client in dependencies");
  return { needed: false, kind: null, evidence: null };
}

function detectDisk(files: Files, deps: Record<string, string>): RepoAnalysis["disk"] {
  if (deps.multer || deps.formidable) return { needed: true, evidence: "file upload library (multer/formidable)" };
  if (deps["better-sqlite3"] || deps.sqlite3) return { needed: true, evidence: "SQLite database file needs persistent storage" };
  for (const f of files.keys()) if (/(^|\/)(uploads|storage\/app\/public)\//.test(f)) return { needed: true, evidence: f };
  return { needed: false, evidence: null };
}

function parseJson<T>(text: string | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

const PLATFORM_SET = new Set<string>(["node", "next", "laravel", "php", "python", "django", "flask", "go", "docker", "static", "react", "vue", "angular", "dotnet"]);
function isPlatform(p: string): p is Platform {
  return PLATFORM_SET.has(p);
}
