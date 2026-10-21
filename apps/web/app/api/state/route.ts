import { appAllowed, CHAOS_SCENARIOS } from "@rahandaz/core";
import fs from "node:fs";
import path from "node:path";
import { guard, json, rz } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const r = rz();
  const { config } = r;
  const apps = (await r.liara.listApps().catch(() => [])).filter((a) => appAllowed(config, a.name)).slice(0, 8);
  const appsWithHealth = await Promise.all(apps.map(async (a) => ({ ...a, health: await r.liara.checkHealth(a.name).catch(() => null) })));
  let fixtures: Array<{ name: string; titleFa: string; hero?: boolean; failure: string | null }> = [];
  try {
    fixtures = JSON.parse(fs.readFileSync(path.join(config.fixturesDir, "fixtures.json"), "utf8")).fixtures;
  } catch {
    fixtures = [];
  }
  return json({
    modes: {
      liara: config.liaraMode,
      llm: r.llm.name,
      dryRun: config.dryRun,
      allowDestructive: config.allowDestructive,
      maxMonthlyCostToman: config.maxMonthlyCostToman,
      allowedApps: config.allowedApps,
      docs: r.docs.info(),
    },
    runs: r.runtime.listRuns().slice(0, 30).map((run) => ({ id: run.id, title: run.title, status: run.status, trigger: run.trigger, createdAt: run.createdAt, appName: run.appName })),
    apps: appsWithHealth,
    fixtures: config.liaraMode === "mock" ? fixtures : [],
    chaos: CHAOS_SCENARIOS,
  });
}
