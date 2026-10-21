/** Wire everything from config: the one place that decides mock vs real. */
import crypto from "node:crypto";
import path from "node:path";
import { MockLiaraClient, RealLiaraClient, type LiaraClient } from "@rahandaz/liara";
import { HealthMonitor } from "./agent/monitor";
import { AgentRuntime } from "./agent/runtime";
import { AuditLog } from "./audit/audit-log";
import { configSecrets, loadConfig, type RahandazConfig } from "./config/config";
import { LiaraDocsIndex, type DocsSearch } from "./knowledge/docs-search";
import { FallbackProvider } from "./llm/fallback";
import { OpenAICompatibleProvider } from "./llm/openai-compatible";
import { ScriptedBrain } from "./llm/scripted-brain";
import type { LlmProvider } from "./llm/types";
import { Redactor } from "./safety/redactor";

export interface Rahandaz {
  config: RahandazConfig;
  redactor: Redactor;
  audit: AuditLog;
  liara: LiaraClient;
  docs: DocsSearch;
  llm: LlmProvider;
  runtime: AgentRuntime;
  monitor: HealthMonitor;
}

export function createRahandaz(overrides: Partial<{ config: RahandazConfig; liara: LiaraClient; llm: LlmProvider; docs: DocsSearch }> = {}): Rahandaz {
  const config = overrides.config ?? loadConfig();
  const redactor = new Redactor();
  for (const s of configSecrets(config)) redactor.addSecret(s);
  const audit = new AuditLog(config.dataDir, redactor);

  const liara =
    overrides.liara ??
    (config.liaraMode === "real"
      ? new RealLiaraClient({ apiToken: config.liara.apiToken, teamId: config.liara.teamId || undefined, baseUrl: config.liara.baseUrl })
      : new MockLiaraClient({
          latencyScale: config.mockLatencyScale,
          // A healthy app is already running in mock mode: the target of «خرابش کن».
          seed: [
            {
              name: "demo-shop",
              platform: "node",
              planId: "earth",
              port: 3000,
              sourceDir: path.join(config.fixturesDir, "demo-shop"),
              env: { SESSION_SECRET: crypto.randomBytes(24).toString("hex") },
            },
          ],
        }));

  const llm =
    overrides.llm ??
    (config.mockLlm
      ? new ScriptedBrain()
      : new FallbackProvider(config.llms.map((l) => new OpenAICompatibleProvider({ ...l, label: l.provider === "liara" ? "Liara AI" : undefined }))));
  const docs = overrides.docs ?? new LiaraDocsIndex(config.docsIndexDir, config.embed);
  const runtime = new AgentRuntime({ config, liara, llm, docs, audit, redactor });
  const monitor = new HealthMonitor(runtime);
  audit.append({ actor: "system", action: "startup", result: "info", detail: `liara=${config.liaraMode} llm=${llm.name} dryRun=${config.dryRun} allowDestructive=${config.allowDestructive}` });
  return { config, redactor, audit, liara, docs, llm, runtime, monitor };
}
