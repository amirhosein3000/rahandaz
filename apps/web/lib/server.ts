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
      g.__rahandaz.monitor.start(Number(process.env.HEALTH_MONITOR_INTERVAL_MS ?? 4000));
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
