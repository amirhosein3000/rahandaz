/**
 * Health monitor: polls app health and, when an app goes from healthy to
 * unhealthy, starts an incident run on its own. Investigation (logs, metrics,
 * docs) is read-only and runs freely; any fix still waits for approval.
 * This is what makes "break it on stage" self-starting.
 */
import { appAllowed } from "../config/config";
import type { AgentRuntime } from "./runtime";

export class HealthMonitor {
  private last = new Map<string, boolean>();
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(private readonly runtime: AgentRuntime) {}

  start(intervalMs = 5000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One poll. Exposed for tests. Returns the run ids it started. */
  async tick(): Promise<string[]> {
    if (this.busy) return [];
    this.busy = true;
    const started: string[] = [];
    try {
      const apps = (await this.runtime.liara.listApps()).filter((a) => appAllowed(this.runtime.config, a.name) && a.isDeployed && a.scale === 1);
      for (const app of apps) {
        const health = await this.runtime.liara.checkHealth(app.name);
        const prev = this.last.get(app.name);
        this.last.set(app.name, health.ok);
        if (prev === true && !health.ok && !this.activeRunFor(app.name)) {
          const run = this.runtime.startRun({
            trigger: "incident",
            actor: "system",
            message: `هشدار خودکار: اپ ${app.name} از دسترس خارج شد (${health.status ?? health.error ?? "بدون پاسخ"}). چرا از کار افتاده و چطور درستش کنیم؟`,
          });
          started.push(run.id);
        }
      }
    } catch (err) {
      console.warn(`[monitor] ${(err as Error).message}`);
    } finally {
      this.busy = false;
    }
    return started;
  }

  status(): Record<string, boolean> {
    return Object.fromEntries(this.last);
  }

  private activeRunFor(app: string): boolean {
    return this.runtime
      .listRuns()
      .some((r) => (r.status === "running" || r.status === "awaiting_approval") && (r.appName === app || r.title.includes(app)));
  }
}
