/**
 * Server-side singleton: one Rahandaz runtime per Node process (survives hot
 * reloads in dev via globalThis). Also the console's access gate: approvals are
 * the user's channel, so a deployed console must not be open to the world.
 */
import crypto from "node:crypto";
import { ChatBot, createRahandaz, type Rahandaz } from "@rahandaz/core";

const g = globalThis as unknown as { __rahandaz?: Rahandaz };

export function rz(): Rahandaz {
  if (!g.__rahandaz) {
    g.__rahandaz = createRahandaz();
    if (process.env.HEALTH_MONITOR !== "false") {
      // Mock checks are free; real checks are HTTP requests to every allowed app, so poll gently.
      const dflt = g.__rahandaz.config.liaraMode === "real" ? 15_000 : 4000;
      g.__rahandaz.monitor.start(Number(process.env.HEALTH_MONITOR_INTERVAL_MS ?? dflt));
    }
    const { chat } = g.__rahandaz.config;
    if (chat.botToken) {
      new ChatBot(g.__rahandaz.runtime, { token: chat.botToken, apiBase: chat.apiBase, allowedChatIds: chat.allowedChatIds, consoleUrl: process.env.CONSOLE_PUBLIC_URL }).start();
    }
  }
  return g.__rahandaz;
}

/**
 * If CONSOLE_PASSWORD is set, every API call needs HTTP Basic auth (any username).
 * Returns a 401 response to send, or null when allowed.
 */
export function guard(req: Request): Response | null {
  const unsafe = req.method !== "GET" && req.method !== "HEAD";
  if (unsafe) {
    const rejected = checkWriteRequest(req, { password: process.env.CONSOLE_PASSWORD, production: process.env.NODE_ENV === "production", allowOpen: process.env.ALLOW_OPEN_CONSOLE === "true" });
    if (rejected) return json({ ok: false, errorFa: rejected.errorFa }, rejected.status);
  }
  const password = process.env.CONSOLE_PASSWORD;
  if (!password) return null;
  const header = req.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const given = decoded.slice(decoded.indexOf(":") + 1);
    const a = crypto.createHash("sha256").update(given).digest();
    const b = crypto.createHash("sha256").update(password).digest();
    if (crypto.timingSafeEqual(a, b)) return null;
  }
  return new Response("auth required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="rahandaz", charset="UTF-8"' } });
}

/**
 * Rules for requests that change something (start runs, approve, break):
 *  - JSON only, and same-origin: a page on another site cannot submit an approval
 *    with the user's cached Basic-auth credentials (CSRF);
 *  - a production console without CONSOLE_PASSWORD refuses changes outright,
 *    unless ALLOW_OPEN_CONSOLE=true is set on purpose.
 */
export function checkWriteRequest(
  req: Request,
  opts: { password?: string; production: boolean; allowOpen: boolean },
): { status: number; errorFa: string } | null {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return { status: 415, errorFa: "درخواست باید JSON باشد." };
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return { status: 403, errorFa: "درخواست از سایت دیگری آمده و رد شد." };
  const origin = req.headers.get("origin");
  if (origin) {
    const hosts = [req.headers.get("x-forwarded-host"), req.headers.get("host")].filter(Boolean).map((h) => h!.split(",")[0]!.trim());
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = "";
    }
    if (!hosts.includes(originHost)) return { status: 403, errorFa: "مبدأ درخواست با کنسول یکی نیست و رد شد." };
  }
  if (opts.production && !opts.password && !opts.allowOpen) {
    return { status: 403, errorFa: "این کنسول عمومی است و CONSOLE_PASSWORD ندارد؛ برای امنیت، هیچ تغییری از اینجا پذیرفته نمی‌شود." };
  }
  return null;
}

/** Who is acting, for the audit log. */
export function actorFrom(req: Request): string {
  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const user = Buffer.from(header.slice(6), "base64").toString("utf8").split(":")[0];
    if (user) return `user:web:${user.replace(/[^\w.-]/g, "").slice(0, 32)}`;
  }
  return "user:web";
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function body<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
