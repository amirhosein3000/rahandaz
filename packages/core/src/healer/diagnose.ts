/**
 * Failure diagnosis. Deterministic rules turn log evidence into a root cause
 * and, where it is safe to automate, a concrete fix (file patch and/or env
 * change). The LLM explains and chooses; it does not invent the patch text for
 * known failures, so a fix can be reviewed as an exact diff.
 */
import fs from "node:fs";
import path from "node:path";
import type { HealthResult, ReleaseState } from "@rahandaz/liara";
import type { RepoAnalysis } from "../analyser/types";
import { unifiedDiff } from "../repo/diff";
import { safeJoin } from "../repo/workspace";

export interface FilePatch {
  path: string;
  before: string;
  after: string;
  diff: string;
}

export interface EnvChange {
  key: string;
  /** Vault reference, never a value (see safety/vault.ts). */
  valueRef: string;
  /** True when the key already exists on the app: that makes it a destructive overwrite. */
  overwrite: boolean;
}

export interface FixProposal {
  id: string;
  titleFa: string;
  files: FilePatch[];
  env: EnvChange[];
  /** A new release is needed (code/config changed or the build failed). */
  redeploy: boolean;
  /** Port the next release should use, when the fix changes it. */
  port?: number;
}

export interface Diagnosis {
  rule:
    | "bad_base_image"
    | "missing_start_script"
    | "missing_env"
    | "missing_app_key"
    | "unpinned_dependency"
    | "port_mismatch"
    | "env_port_override"
    | "crash_unknown"
    | "http_5xx";
  titleFa: string;
  explanationFa: string;
  /** One sentence for a non-engineer: no ports, builds or file jargon. */
  plainFa: string;
  evidence: string[];
  confidence: number;
  /** Query for search_liara_docs, so the explanation can cite the docs. */
  docsQuery: string;
  fix: FixProposal | null;
}

export interface DiagnoseInput {
  buildLines: string[];
  appLogs: string[];
  releaseState?: ReleaseState;
  releasePort?: number;
  failReason?: string;
  health?: HealthResult | null;
  analysis?: RepoAnalysis | null;
  workspaceDir?: string | null;
  appEnvKeys: string[];
  platform?: string;
}

let fixSeq = 0;
const newFixId = () => `fix_${(++fixSeq).toString(36)}_${Date.now().toString(36).slice(-4)}`;

export function diagnose(input: DiagnoseInput): Diagnosis[] {
  const lines = [...input.buildLines, ...input.appLogs];
  const find = (re: RegExp) => lines.find((l) => re.test(l));
  const out: Diagnosis[] = [];
  const ws = input.workspaceDir ?? null;

  // 1. Base image does not exist.
  const pull = find(/pull access denied for ([\w./-]+)|manifest for (\S+) not found/);
  if (pull) {
    const m = pull.match(/pull access denied for ([\w./-]+)|manifest for (\S+) not found/)!;
    const bad = m[1] ?? m[2]!;
    out.push({
      rule: "bad_base_image",
      titleFa: "ایمیج پایه‌ی Dockerfile وجود ندارد",
      plainFa: "نام یکی از پایه‌های پروژه (در فایل Dockerfile) اشتباه نوشته شده و لیارا نتوانست پیدایش کند؛ درستش می‌کنم.",
      explanationFa: `بیلد در همان قدم اول (FROM) شکست خورد: ایمیج «${bad}» در رجیستری پیدا نشد. معمولاً اشتباه تایپی در نام یا تگ است.`,
      evidence: [pull],
      confidence: 0.95,
      docsQuery: "استقرار برنامه Docker در لیارا Dockerfile",
      fix: ws ? fixBaseImage(ws, bad) : null,
    });
  }

  // 2. No start script.
  const noStart = find(/Missing script: "start"/);
  if (noStart) {
    out.push({
      rule: "missing_start_script",
      titleFa: "اسکریپت start در package.json تعریف نشده",
      plainFa: "در پروژه نوشته نشده سایت با چه دستوری روشن شود؛ یک خط کوچک به آن اضافه می‌کنم.",
      explanationFa: "بیلد موفق بود ولی موقع اجرا npm start شکست خورد، چون package.json اسکریپت start ندارد. برنامه مدام ری‌استارت می‌شود.",
      evidence: [noStart],
      confidence: 0.97,
      docsQuery: "اسکریپت start در package.json برنامه NodeJS",
      fix: ws ? fixStartScript(ws) : null,
    });
  }

  // 3. Missing env var the code refuses to run without.
  const missingEnvLine = find(/Missing required environment variable:?\s*([A-Z_][A-Z0-9_]*)/);
  if (missingEnvLine) {
    const key = missingEnvLine.match(/Missing required environment variable:?\s*([A-Z_][A-Z0-9_]*)/)![1]!;
    const buildFailed = input.releaseState === "FAILED";
    out.push({
      rule: "missing_env",
      titleFa: `متغیر محیطی ${key} تنظیم نشده`,
      plainFa: `سایت برای کار کردن به تنظیمی به نام ${key} نیاز دارد که هنوز وارد نشده.`,
      explanationFa: `کد برنامه بدون ${key} اجرا نمی‌شود و این متغیر روی اپ تعریف نشده است${buildFailed ? "؛ چون در زمان بیلد خوانده می‌شود، بیلد شکست خورد" : "؛ برنامه هنگام شروع کرش می‌کند"}.`,
      evidence: [missingEnvLine],
      confidence: 0.95,
      docsQuery: `استفاده از متغیرهای محیطی ${docsPlatform(input.platform)}`,
      fix: {
        id: newFixId(),
        titleFa: `تنظیم ${key} روی اپ${buildFailed ? " و دیپلوی دوباره" : ""}`,
        files: [],
        env: [{ key, valueRef: refFor(key, input.platform), overwrite: input.appEnvKeys.includes(key) }],
        redeploy: buildFailed,
      },
    });
  }

  // 4. Laravel without APP_KEY.
  const appKey = find(/No application encryption key has been specified/);
  if (appKey) {
    out.push({
      rule: "missing_app_key",
      titleFa: "APP_KEY برای Laravel تنظیم نشده",
      plainFa: "سایت یک کلید امنیتی لازم دارد که ساخته نشده بود؛ خودم یک کلید امن می‌سازم.",
      explanationFa: "اپ بالا آمده ولی هر درخواست خطای ۵۰۰ می‌دهد: Laravel بدون APP_KEY نمی‌تواند کوکی‌ها و سشن را رمز کند. یک کلید تصادفی روی سرور می‌سازیم؛ مقدارش را نه مدل می‌بیند نه لاگ.",
      evidence: [appKey.slice(0, 220)],
      confidence: 0.97,
      docsQuery: "استفاده از متغیرهای محیطی laravel APP_KEY",
      fix: {
        id: newFixId(),
        titleFa: "ساخت APP_KEY تصادفی و تنظیم آن روی اپ",
        files: [],
        env: [{ key: "APP_KEY", valueRef: "generate:laravel_app_key", overwrite: input.appEnvKeys.includes("APP_KEY") }],
        redeploy: false,
      },
    });
  }

  // 5. Flask 2.x + Werkzeug 3 (unpinned transitive dependency).
  const urlQuote = find(/cannot import name 'url_quote' from 'werkzeug\.urls'/);
  if (urlQuote) {
    out.push({
      rule: "unpinned_dependency",
      titleFa: "نسخه‌ی Werkzeug با Flask 2.2 سازگار نیست",
      plainFa: "یکی از کتابخانه‌های پروژه خودبه‌خود به نسخه‌ای جدید رفته که با بقیه جور نیست؛ نسخه‌ی سازگار را ثابت می‌کنم.",
      explanationFa: "Werkzeug در requirements.txt پین نشده و نسخه‌ی ۳ نصب شده که url_quote را حذف کرده؛ Flask 2.2 هنگام import کرش می‌کند. نسخه‌ی سازگار را پین می‌کنیم.",
      evidence: [urlQuote],
      confidence: 0.96,
      docsQuery: "نسخه پکیج‌ها requirements.txt برنامه پایتون",
      fix: ws ? fixPinWerkzeug(ws) : null,
    });
  }

  // 6. Health check on a port nobody listens on.
  const refused = find(/dial tcp [\d.]+:(\d+): connect: connection refused|nothing listening on port (\d+)/);
  const LISTEN_RE = /listening (?:on|at)\b.*?[:\s](\d{2,5})\b/i;
  const listening = [...input.appLogs].reverse().find((l) => LISTEN_RE.test(l));
  if (refused) {
    const pm = refused.match(/:(\d+): connect|port (\d+)/)!;
    const probePort = Number(pm[1] ?? pm[2]);
    const listenPort = listening ? Number(listening.match(LISTEN_RE)![1]) : null;
    const codeReadsEnvPort = input.analysis?.portEvidence.some((e) => e.includes("process.env.PORT")) ?? false;
    // Without a repo (operate mode) a PORT env var on the app is the prime suspect.
    const envPort = input.appEnvKeys.includes("PORT") && (codeReadsEnvPort || !input.analysis);
    if (listenPort && listenPort !== probePort && envPort) {
      out.push({
        rule: "env_port_override",
        titleFa: "متغیر محیطی PORT با پورت اپ یکی نیست",
        plainFa: "یک تنظیم اشتباه باعث شده سایت جایی منتظر بماند که لیارا سراغش نمی‌رود؛ آن را برمی‌گردانم.",
        explanationFa: `لیارا پورت ${probePort} را چک می‌کند ولی متغیر PORT روی اپ باعث شده برنامه روی ${listenPort} گوش بدهد. PORT را به ${probePort} برمی‌گردانیم (بازنویسی متغیر = عملیات حساس، تأیید دوم لازم است).`,
        evidence: [listening!, refused],
        confidence: 0.93,
        docsQuery: "فایل liara.json تنظیم پورت برنامه port",
        fix: { id: newFixId(), titleFa: `بازگرداندن PORT به ${probePort}`, files: [], env: [{ key: "PORT", valueRef: `literal:${probePort}`, overwrite: true }], redeploy: false },
      });
    } else if (listenPort && listenPort !== probePort) {
      out.push({
        rule: "port_mismatch",
        titleFa: `برنامه روی ${listenPort} گوش می‌دهد، لیارا ${probePort} را چک می‌کند`,
        plainFa: "سایت جایی منتظر بازدیدکننده است که لیارا سراغش نمی‌رود؛ این دو را با هم یکی می‌کنم.",
        explanationFa: `ریلیز با پورت ${probePort} ساخته شد ولی لاگ برنامه نشان می‌دهد روی ${listenPort} بالا آمده؛ health check به پورت خالی می‌خورد و ریلیز UNHEALTHY می‌شود. پورت liara.json را با پورت واقعی برنامه یکی می‌کنیم و دوباره دیپلوی می‌کنیم.`,
        evidence: [listening!, refused],
        confidence: 0.94,
        docsQuery: "تنظیم پورت برنامه liara.json port",
        fix: ws ? fixLiaraJsonPort(ws, listenPort, input.analysis?.platform ?? input.platform ?? "node") : null,
      });
    }
  }

  // 7. Fallbacks when nothing specific matched.
  if (out.length === 0) {
    const crash = find(/exited with code [1-9]|Traceback|Error:|ERROR/);
    if (crash) {
      out.push({
        rule: "crash_unknown",
        titleFa: "برنامه با خطا متوقف می‌شود",
        plainFa: "سایت موقع روشن شدن از کار می‌افتد و علت شناخته‌شده‌ای پیدا نکردم؛ لازم است برنامه‌نویس کد را ببیند.",
        explanationFa: "خطای شناخته‌شده‌ای پیدا نکردم؛ خطوط مهم لاگ را آورده‌ام. پیشنهاد خودکاری ندارم و نیاز به بررسی کد دارد.",
        evidence: lines.filter((l) => /error|exception|traceback|exited/i.test(l)).slice(-5),
        confidence: 0.4,
        docsQuery: crash.slice(0, 120),
        fix: null,
      });
    } else if (input.health && input.health.status && input.health.status >= 500) {
      out.push({
        rule: "http_5xx",
        titleFa: `اپ خطای ${input.health.status} برمی‌گرداند`,
        plainFa: "سایت روشن است ولی به بازدیدکننده‌ها صفحه‌ی خطا نشان می‌دهد.",
        explanationFa: "اپ بالا است ولی به درخواست‌ها خطای سرور می‌دهد و لاگ دلیل مشخصی ندارد.",
        evidence: [`GET ${input.health.url} → ${input.health.status}`],
        confidence: 0.35,
        docsQuery: "خطای 502 503 برنامه",
        fix: null,
      });
    }
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

function refFor(key: string, platform?: string): string {
  if (key === "APP_KEY" && platform === "laravel") return "generate:laravel_app_key";
  if (/^(SESSION_SECRET|COOKIE_SECRET|JWT_SECRET|SECRET_KEY|APP_SECRET|NEXTAUTH_SECRET|AUTH_SECRET)$/.test(key)) return "generate:secret";
  return `user:${key}`;
}

function read(ws: string, rel: string): string | null {
  const abs = safeJoin(ws, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

function patch(rel: string, before: string, after: string): FilePatch {
  return { path: rel, before, after, diff: unifiedDiff(rel, before, after) };
}

function fixBaseImage(ws: string, bad: string): FixProposal | null {
  const before = read(ws, "Dockerfile");
  if (!before) return null;
  const [name, tag = "latest"] = bad.split(":") as [string, string?];
  const renames: Record<string, string> = { nodejs: "node", "node-js": "node", python3: "python", go: "golang", php8: "php" };
  const goodName = renames[name] ?? name;
  const defaults: Record<string, string> = { node: "20-alpine", python: "3.12-slim", golang: "1.23-alpine", php: "8.3-fpm" };
  // A misspelt repository keeps its tag; a real repository with a bad tag gets a known-good tag.
  const good = goodName !== name ? `${goodName}:${tag}` : `${goodName}:${defaults[goodName] ?? "latest"}`;
  const after = before.replace(new RegExp(`^(\\s*FROM\\s+)${escapeRe(bad)}`, "m"), `$1${good}`);
  if (after === before) return null;
  return { id: newFixId(), titleFa: `اصلاح ایمیج پایه به ${good}`, files: [patch("Dockerfile", before, after)], env: [], redeploy: true };
}

function fixStartScript(ws: string): FixProposal | null {
  const before = read(ws, "package.json");
  if (!before) return null;
  let pkg: { main?: string; scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(before);
  } catch {
    return null;
  }
  const entry =
    pkg.main ??
    ["server.js", "index.js", "app.js", "src/index.js", "src/server.js"].find((f) => fs.existsSync(path.join(ws, f)));
  const fromDev = pkg.scripts?.dev?.replace(/\s--watch\b/, "").replace(/^nodemon\b/, "node");
  const start = entry ? `node ${entry}` : fromDev ?? null;
  if (!start) return null;
  const next = { ...pkg, scripts: { ...(pkg.scripts ?? {}), start } };
  const after = JSON.stringify(next, null, 2) + "\n";
  return { id: newFixId(), titleFa: `افزودن "start": "${start}" به package.json`, files: [patch("package.json", before, after)], env: [], redeploy: true };
}

function fixPinWerkzeug(ws: string): FixProposal | null {
  const before = read(ws, "requirements.txt");
  if (before === null) return null;
  const lines = before.replace(/\n$/, "").split("\n");
  const idx = lines.findIndex((l) => /^\s*werkzeug\b/i.test(l));
  if (idx >= 0) lines[idx] = "Werkzeug==2.2.3";
  else lines.push("Werkzeug==2.2.3");
  const after = lines.join("\n") + "\n";
  return { id: newFixId(), titleFa: "پین‌کردن Werkzeug==2.2.3 در requirements.txt", files: [patch("requirements.txt", before, after)], env: [], redeploy: true };
}

function fixLiaraJsonPort(ws: string, port: number, platform: string): FixProposal {
  const before = read(ws, "liara.json") ?? "";
  let cfg: Record<string, unknown> = {};
  try {
    cfg = before ? JSON.parse(before) : {};
  } catch {
    cfg = {};
  }
  const after = JSON.stringify({ platform, ...cfg, port }, null, 2) + "\n";
  return {
    id: newFixId(),
    titleFa: `یکی‌کردن پورت liara.json با پورت برنامه (${port})`,
    files: [patch("liara.json", before, after)],
    env: [],
    redeploy: true,
    port,
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Apply file patches to the workspace. Refuses if a file changed since the patch was computed. */
export function applyFilePatches(ws: string, files: FilePatch[]): void {
  for (const f of files) {
    const abs = safeJoin(ws, f.path);
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
    if (current !== f.before) throw new Error(`${f.path} changed since the fix was proposed; diagnose again`);
  }
  for (const f of files) {
    const abs = safeJoin(ws, f.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.after, "utf8");
  }
}

/** Platform word as the docs spell it, to steer search toward the right platform's page. */
function docsPlatform(platform?: string): string {
  const names: Record<string, string> = { node: "nodejs", next: "nextjs", laravel: "laravel", php: "php", python: "python", django: "django", flask: "flask", go: "go", docker: "docker" };
  return names[platform ?? ""] ?? "";
}
