/**
 * Synthetic production traffic for mock apps: access-log lines with status
 * codes and latencies, plus the application errors a given condition produces.
 * Deterministic (seeded by the app name and minute), so tests are stable and the
 * console shows the same story twice.
 *
 * Line format (common for Node/Express-style loggers):
 *   GET /products 200 84ms
 */
import type { AppLogLine } from "../types";

/** Production conditions a mock app can be in ("break it on stage" sets these). */
export type AppCondition = "ok" | "memory_pressure" | "db_down";

const ROUTES = ["/", "/products", "/products/42", "/cart", "/api/orders", "/static/app.js", "/api/health"];

function rand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10_000) / 10_000;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Access + error lines for the last `minutes`, ending at `now`. */
export function trafficLines(app: string, condition: AppCondition, now: number, minutes = 10): AppLogLine[] {
  const r = rand(hash(app) ^ Math.floor(now / 60_000));
  const out: AppLogLine[] = [];
  const count = 48;
  for (let i = 0; i < count; i++) {
    const ts = new Date(now - Math.round(((count - i) / count) * minutes * 60_000)).toISOString();
    const route = ROUTES[Math.floor(r() * ROUTES.length)]!;
    const method = route.startsWith("/api/orders") && r() < 0.4 ? "POST" : "GET";
    let status = 200;
    let ms = Math.round(35 + r() * 120);
    if (route.startsWith("/static")) ms = Math.round(4 + r() * 10);

    if (condition === "memory_pressure") {
      ms = Math.round(1400 + r() * 2800);
      if (r() < 0.08) status = 502;
      if (i === 17 || i === 38) {
        out.push({ ts, type: "stderr", message: "<--- Last few GCs --->" });
        out.push({ ts, type: "stderr", message: "[1:0x5b2a1c0]   832101 ms: Mark-Compact 489.6 (512.2) -> 487.9 (512.9) MB, 1204.33 / 0.00 ms  (average mu = 0.112) allocation failure; scavenge might not succeed" });
        out.push({ ts, type: "stderr", message: "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory" });
        out.push({ ts, type: "system", message: "[system] container exited with code 134 (OOMKilled), restarting" });
      }
    }
    if (condition === "db_down" && (route === "/cart" || route.startsWith("/api/orders") || route.startsWith("/products/"))) {
      status = 500;
      ms = Math.round(8 + r() * 20);
      out.push({ ts, type: "stderr", message: "Error: connect ECONNREFUSED 10.10.0.5:5432" });
      out.push({ ts, type: "stderr", message: "    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1607:16)" });
    }
    out.push({ ts, type: status >= 500 ? "stderr" : "stdout", message: `${method} ${route} ${status} ${ms}ms` });
  }
  return out;
}

/** Resource picture for a condition, given the plan's RAM. */
export function conditionMetrics(condition: AppCondition, ramMb: number, app: string): { cpu: number; memMb: number; p50: number } {
  const j = hash(app) % 5;
  if (condition === "memory_pressure") return { cpu: 78 + j, memMb: Math.round(ramMb * 0.96), p50: 2600 + j * 40 };
  if (condition === "db_down") return { cpu: 11 + j, memMb: 160 + j * 9, p50: 70 + j * 5 };
  return { cpu: 9 + j, memMb: 168 + j * 11, p50: 84 + j * 6 };
}
