/**
 * Mock "Liara builder": decides what a release of a given source tree would do
 * on the platform. It reads the files itself and does NOT share code with the
 * agent's analyser in @rahandaz/core, so a mock run can't pass just because the
 * agent and the mock agree with each other. When the agent fixes the repo, the
 * next simulated release changes because the files changed.
 *
 * Failure messages are modelled on the real tools' output (npm, pip, Docker,
 * Laravel, Next.js), so the diagnosis rules and docs search see realistic text.
 */
import type { FileSnapshot } from "./snapshot";

export interface SimulateInput {
  files: FileSnapshot;
  platform: string;
  /** Port the release was created with (what Liara health-checks). */
  port: number;
  /** Env vars configured on the app. Values stay inside the mock. */
  env: ReadonlyMap<string, string>;
}

export interface SimulatedOutcome {
  buildLines: string[];
  buildOk: boolean;
  /** Release state once the release settles. */
  finalState: "READY" | "FAILED" | "UNHEALTHY";
  failReason?: string;
  /** Runtime log lines emitted after start. */
  runtimeLines: string[];
  /** What GET / returns once the release is live (0 = connection refused). */
  httpStatus: number;
  listeningPort: number | null;
}

const VALID_IMAGE_TAGS: Record<string, RegExp> = {
  node: /^(18|20|22|24)(\.\d+){0,2}(-(alpine|slim|bookworm|bullseye)(\d+(\.\d+)?)?)?$|^(lts|current)(-alpine|-slim)?$/,
  python: /^3\.(9|10|11|12|13)(\.\d+)?(-(slim|alpine|bookworm|bullseye))?$/,
  php: /^8\.[1-4](\.\d+)?(-(fpm|apache|cli|alpine|fpm-alpine))?$/,
  golang: /^1\.(21|22|23|24|25)(\.\d+)?(-alpine)?$/,
  nginx: /^(stable|mainline|latest|1\.\d+(\.\d+)?)(-alpine)?$/,
  alpine: /^(3\.\d+|latest)$/,
};

export function simulateRelease(input: SimulateInput): SimulatedOutcome {
  const { files, platform } = input;
  if (files.has("Dockerfile") && (platform === "docker" || !files.has("package.json"))) return simulateDocker(input);
  if (platform === "laravel" || platform === "php") return simulateLaravel(input);
  if (platform === "python" || platform === "flask" || platform === "django") return simulatePython(input);
  if (platform === "node" || platform === "next" || files.has("package.json")) return simulateNode(input);
  return ok(input, ["==> Static/unknown platform: copying files", "==> Done"], ["serving files"], input.port);
}

// ── Docker ─────────────────────────────────────────────────────

function simulateDocker(input: SimulateInput): SimulatedOutcome {
  const dockerfile = input.files.get("Dockerfile") ?? "";
  const froms = [...dockerfile.matchAll(/^\s*FROM\s+([^\s]+)/gim)].map((m) => m[1]!);
  const steps = dockerfile.split("\n").filter((l) => /^\s*[A-Z]+\s/.test(l)).length || 1;
  const lines = ["==> Building image with Docker", "Sending build context to Docker daemon  1.2MB"];
  for (const image of froms) {
    lines.push(`Step 1/${steps} : FROM ${image}`);
    const [name, tag = "latest"] = image.split(":") as [string, string?];
    const known = VALID_IMAGE_TAGS[name.replace(/^library\//, "")];
    if (!known) {
      lines.push(`pull access denied for ${name}, repository does not exist or may require 'docker login': denied: requested access to the resource is denied`);
      lines.push("Build failed.");
      return failBuild(lines, `docker pull failed: repository ${name} does not exist`);
    }
    if (!known.test(tag)) {
      lines.push(`manifest for ${image} not found: manifest unknown: manifest unknown`);
      lines.push("Build failed.");
      return failBuild(lines, `docker pull failed: manifest for ${image} not found`);
    }
    lines.push(` ---> Pulling ${image}`, " ---> 3f1c2a9b7e10");
  }
  lines.push(" ---> Running build steps", `Successfully tagged app:latest`, "Pushing... 100%");
  const exposed = Number(dockerfile.match(/^\s*EXPOSE\s+(\d+)/im)?.[1] ?? NaN);
  const listening = Number.isFinite(exposed) ? exposed : input.port;
  return portCheck(input, lines, [`container started, listening on ${listening}`], listening);
}

// ── Node / Next.js ─────────────────────────────────────────────

function simulateNode(input: SimulateInput): SimulatedOutcome {
  const pkgRaw = input.files.get("package.json");
  if (!pkgRaw) return failBuild(["==> Detected Node.js", "npm error enoent Could not read package.json"], "package.json not found");
  let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; main?: string };
  try {
    pkg = JSON.parse(pkgRaw);
  } catch {
    return failBuild(["==> Detected Node.js", "npm error code EJSONPARSE", "npm error JSON.parse Invalid package.json"], "invalid package.json");
  }
  const isNext = input.platform === "next" || Boolean(pkg.dependencies?.next);
  const lines = [`==> Detected ${isNext ? "Next.js" : "Node.js"} app`, "==> Installing dependencies", "> npm ci", "added 214 packages in 9s"];
  const missingEnv = requiredEnvMissing(input);

  if (pkg.scripts?.build) {
    lines.push("> npm run build", `> ${pkg.scripts.build}`);
    if (isNext) {
      lines.push("   ▲ Next.js 15.1.0", "   Creating an optimized production build ...", " ✓ Compiled successfully", "   Collecting page data ...");
      if (missingEnv) {
        lines.push(
          `Error: Missing required environment variable: ${missingEnv}`,
          "    at loadConfig (.next/server/chunks/412.js:1:2203)",
          "> Build error occurred",
          `Error: Failed to collect page data for /`,
        );
        return failBuild(lines, `next build failed: missing environment variable ${missingEnv}`);
      }
      lines.push(" ✓ Generating static pages (5/5)");
    }
  }
  lines.push("Successfully tagged app:latest", "Pushing... 100%");

  if (!pkg.scripts?.start) {
    return crash(input, lines, [
      "npm error Missing script: \"start\"",
      "npm error",
      "npm error To see a list of scripts, run:",
      "npm error   npm run",
      "npm error A complete log of this run can be found in: /root/.npm/_logs/debug-0.log",
    ]);
  }
  if (missingEnv) {
    return crash(input, lines, [
      `> ${pkg.scripts.start}`,
      `Error: Missing required environment variable: ${missingEnv}`,
      "    at Object.<anonymous> (/app/server.js:4:9)",
      "Node.js v22.11.0",
    ]);
  }
  const listening = isNext ? Number(input.env.get("PORT") ?? 3000) : detectNodePort(input);
  return portCheck(input, lines, [`> ${pkg.scripts.start}`, `Server listening on http://0.0.0.0:${listening}`], listening);
}

/** Port the Node app will actually bind, given its source and the app's env. */
function detectNodePort(input: SimulateInput): number {
  for (const [file, src] of input.files) {
    if (!/\.(m?js|cjs|ts)$/.test(file)) continue;
    const fallback = src.match(/process\.env\.PORT\s*(?:\|\||\?\?)\s*(\d{2,5})/);
    if (fallback) {
      const fromEnv = Number(input.env.get("PORT"));
      return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : Number(fallback[1]);
    }
    const literal = src.match(/\.listen\(\s*(\d{2,5})/);
    if (literal) return Number(literal[1]);
    const constPort = src.match(/(?:const|let)\s+PORT\s*=\s*(\d{2,5})/);
    if (constPort && /\.listen\(\s*PORT/.test(src)) return Number(constPort[1]);
  }
  return Number(input.env.get("PORT") ?? 3000);
}

/** First env var that the code explicitly refuses to start without, and that is not set. */
function requiredEnvMissing(input: SimulateInput): string | null {
  const patterns = [
    /requireEnv\(\s*["'`](\w+)["'`]\s*\)/g,
    /if\s*\(\s*!\s*process\.env\.(\w+)\s*\)\s*\{?\s*throw/g,
  ];
  for (const [file, src] of input.files) {
    if (!/\.(m?[jt]sx?|cjs)$/.test(file)) continue;
    for (const re of patterns) {
      for (const m of src.matchAll(re)) {
        if (!input.env.has(m[1]!)) return m[1]!;
      }
    }
  }
  return null;
}

// ── Python ─────────────────────────────────────────────────────

function simulatePython(input: SimulateInput): SimulatedOutcome {
  const req = input.files.get("requirements.txt");
  const lines = ["==> Detected Python app", "> pip install -r requirements.txt"];
  if (!req) return failBuild([...lines, "ERROR: Could not open requirements file: [Errno 2] No such file or directory: 'requirements.txt'"], "requirements.txt not found");

  const pins = parseRequirements(req);
  for (const [name, version] of pins) {
    lines.push(`Collecting ${name}${version ? `==${version}` : ""}`);
  }
  const flask = pins.get("flask");
  const werkzeug = pins.get("werkzeug");
  // The classic: Flask 2.0–2.2 imports werkzeug.urls.url_quote, removed in Werkzeug 3.0.
  const resolvedWerkzeug = werkzeug ?? "3.0.6";
  const installed = [...pins].map(([n, v]) => `${n}-${n === "werkzeug" ? resolvedWerkzeug : (v ?? "latest")}`);
  if (flask && !pins.has("werkzeug")) installed.push(`werkzeug-${resolvedWerkzeug}`);
  lines.push(`Successfully installed ${installed.join(" ")}`);
  lines.push("Successfully tagged app:latest", "Pushing... 100%");

  if (flask && /^2\.[0-2]\b/.test(flask) && /^3\./.test(resolvedWerkzeug)) {
    return crash(input, lines, [
      "[INFO] Starting gunicorn 23.0.0",
      "[ERROR] Exception in worker process",
      "Traceback (most recent call last):",
      '  File "/app/app.py", line 1, in <module>',
      "    from flask import Flask",
      '  File "/usr/local/lib/python3.12/site-packages/flask/__init__.py", line 5, in <module>',
      "    from .app import Flask as Flask",
      "ImportError: cannot import name 'url_quote' from 'werkzeug.urls' (/usr/local/lib/python3.12/site-packages/werkzeug/urls.py)",
      "[INFO] Worker exiting (pid: 8)",
    ]);
  }
  return portCheck(input, lines, ["[INFO] Starting gunicorn 23.0.0", `[INFO] Listening at: http://0.0.0.0:${input.port}`], input.port);
}

function parseRequirements(text: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line || line.startsWith("-")) continue;
    const m = line.match(/^([A-Za-z0-9_.-]+)\s*(?:==\s*([\w.]+))?/);
    if (m) out.set(m[1]!.toLowerCase(), m[2] ?? null);
  }
  return out;
}

// ── Laravel / PHP ──────────────────────────────────────────────

function simulateLaravel(input: SimulateInput): SimulatedOutcome {
  const lines = [
    "==> Detected Laravel app",
    "> composer install --no-dev --optimize-autoloader",
    "Generating optimized autoload files",
    "> php artisan config:cache",
    "Configuration cached successfully.",
    "Successfully tagged app:latest",
    "Pushing... 100%",
  ];
  if (!input.env.has("APP_KEY")) {
    // The release itself goes READY: the container is up, but every request 500s.
    return {
      buildLines: lines,
      buildOk: true,
      finalState: "READY",
      runtimeLines: [
        "[php-fpm] ready to handle connections",
        `[${new Date().toISOString()}] production.ERROR: No application encryption key has been specified. {"exception":"[object] (Illuminate\\\\Encryption\\\\MissingAppKeyException(code: 0): No application encryption key has been specified. at /var/www/html/vendor/laravel/framework/src/Illuminate/Encryption/EncryptionServiceProvider.php:83)"}`,
        '"GET / HTTP/1.1" 500',
      ],
      httpStatus: 500,
      listeningPort: input.port,
    };
  }
  return ok(input, lines, ["[php-fpm] ready to handle connections", '"GET / HTTP/1.1" 200'], input.port);
}

// ── helpers ────────────────────────────────────────────────────

function ok(input: SimulateInput, buildLines: string[], runtimeLines: string[], listeningPort: number): SimulatedOutcome {
  return { buildLines, buildOk: true, finalState: "READY", runtimeLines, httpStatus: 200, listeningPort };
}

function failBuild(buildLines: string[], failReason: string): SimulatedOutcome {
  return { buildLines, buildOk: false, finalState: "FAILED", failReason, runtimeLines: [], httpStatus: 0, listeningPort: null };
}

function crash(input: SimulateInput, buildLines: string[], crashLines: string[]): SimulatedOutcome {
  return {
    buildLines,
    buildOk: true,
    finalState: "UNHEALTHY",
    failReason: "container exited with code 1 (CrashLoopBackOff)",
    runtimeLines: [...crashLines, "[system] container exited with code 1, restarting (back-off 10s)", ...crashLines.slice(0, 2)],
    httpStatus: 0,
    listeningPort: null,
  };
}

function portCheck(input: SimulateInput, buildLines: string[], runtimeLines: string[], listening: number): SimulatedOutcome {
  if (listening === input.port) return ok(input, buildLines, runtimeLines, listening);
  return {
    buildLines,
    buildOk: true,
    finalState: "UNHEALTHY",
    failReason: `health check failed: nothing listening on port ${input.port}`,
    runtimeLines: [
      ...runtimeLines,
      `[system] Readiness probe failed: dial tcp 10.42.0.17:${input.port}: connect: connection refused`,
      `[system] Readiness probe failed: dial tcp 10.42.0.17:${input.port}: connect: connection refused`,
      "[system] release marked UNHEALTHY after 5 failed health checks",
    ],
    httpStatus: 0,
    listeningPort: listening,
  };
}
