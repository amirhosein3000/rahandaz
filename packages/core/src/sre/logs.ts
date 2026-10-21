/**
 * Log analysis for the SRE agent: HTTP traffic statistics from access lines,
 * and error clustering (lines normalised so the same error with different
 * ids/numbers counts as one).
 */

export interface HttpStats {
  requests: number;
  errors5xx: number;
  errors4xx: number;
  errorRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  slowest: Array<{ route: string; p50Ms: number; count: number }>;
  failingRoutes: Array<{ route: string; count: number; status: number }>;
}

export interface ErrorCluster {
  signature: string;
  sample: string;
  count: number;
  firstTs: string;
  lastTs: string;
}

export interface LogAnalysis {
  lines: number;
  windowMinutes: number;
  http: HttpStats;
  clusters: ErrorCluster[];
  oomKills: number;
  restarts: number;
}

const ACCESS_RE = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)\s+(\d{3})\s+(\d+(?:\.\d+)?)\s*ms\b/;
const ERROR_RE = /(error|exception|traceback|fatal|failed|refused|timeout|timed out|oom|killed|panic|unhandled)/i;

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

/** Same error, different numbers/ids/paths → same signature. */
export function signature(line: string): string {
  return line
    .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?\b/g, "<ts>")
    .replace(/\b[0-9a-f]{8,}\b/gi, "<id>")
    .replace(/\b\d+(\.\d+)*\b/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export function analyseLogs(lines: Array<{ ts: string; message: string }>, windowMinutes: number): LogAnalysis {
  const lat: number[] = [];
  const byRoute = new Map<string, number[]>();
  const failing = new Map<string, { count: number; status: number }>();
  let e5 = 0;
  let e4 = 0;
  const clusters = new Map<string, ErrorCluster>();
  let oom = 0;
  let restarts = 0;

  for (const { ts, message } of lines) {
    const m = message.match(ACCESS_RE);
    if (m) {
      const route = m[2]!.split("?")[0]!;
      const status = Number(m[3]);
      const ms = Number(m[4]);
      lat.push(ms);
      (byRoute.get(route) ?? byRoute.set(route, []).get(route)!).push(ms);
      if (status >= 500) {
        e5++;
        const f = failing.get(route) ?? { count: 0, status };
        f.count++;
        failing.set(route, f);
      } else if (status >= 400) e4++;
      continue;
    }
    if (/out of memory|OOMKilled|heap limit/i.test(message)) oom += /OOMKilled|exited with code 137|code 134/i.test(message) ? 1 : 0;
    if (/exited with code|restarting/i.test(message)) restarts++;
    if (!ERROR_RE.test(message) || /^\s+at\s/.test(message)) continue;
    const sig = signature(message);
    const c = clusters.get(sig);
    if (c) {
      c.count++;
      c.lastTs = ts;
    } else clusters.set(sig, { signature: sig, sample: message.slice(0, 240), count: 1, firstTs: ts, lastTs: ts });
  }

  lat.sort((a, b) => a - b);
  const requests = lat.length;
  return {
    lines: lines.length,
    windowMinutes,
    http: {
      requests,
      errors5xx: e5,
      errors4xx: e4,
      errorRate: requests ? e5 / requests : 0,
      p50Ms: percentile(lat, 50),
      p95Ms: percentile(lat, 95),
      slowest: [...byRoute]
        .map(([route, v]) => ({ route, p50Ms: percentile([...v].sort((a, b) => a - b), 50) ?? 0, count: v.length }))
        .sort((a, b) => b.p50Ms - a.p50Ms)
        .slice(0, 3),
      failingRoutes: [...failing].map(([route, f]) => ({ route, ...f })).sort((a, b) => b.count - a.count).slice(0, 5),
    },
    clusters: [...clusters.values()].sort((a, b) => b.count - a.count).slice(0, 6),
    oomKills: oom,
    restarts,
  };
}
