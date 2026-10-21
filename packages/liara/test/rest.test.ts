/** RealLiaraClient request shapes, against a fake fetch (no network). */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RealLiaraClient } from "../src/real/rest";
import { listSourceFiles } from "../src/real/archive";

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures");

function fake(responses: Record<string, { status?: number; body: unknown }>) {
  const calls: Array<{ method: string; url: URL; auth: string | null; body: unknown }> = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({ method, url, auth: new Headers(init?.headers).get("authorization"), body: init?.body });
    const key = `${method} ${url.pathname}`;
    const r = responses[key] ?? { status: 404, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("RealLiaraClient", () => {
  it("sends the bearer token and teamID on every request, maps projects", async () => {
    const f = fake({ "GET /v1/projects": { body: { projects: [{ _id: "1", project_id: "shop", type: "node", status: "ACTIVE", scale: 1, planID: "x", isDeployed: true }] } } });
    const c = new RealLiaraClient({ apiToken: "tok123456", teamId: "team9", fetchImpl: f.fetchImpl });
    const apps = await c.listApps();
    expect(apps[0]).toMatchObject({ name: "shop", platform: "node", status: "running" });
    expect(f.calls[0]!.auth).toBe("Bearer tok123456");
    expect(f.calls[0]!.url.searchParams.get("teamID")).toBe("team9");
    expect(f.calls[0]!.url.origin).toBe("https://api.liara.ir");
  });

  it("drops env values at the edge: getApp exposes names only", async () => {
    const f = fake({ "GET /v1/projects/shop": { body: { project: { project_id: "shop", envs: [{ key: "DB_URL", value: "postgres://u:p@h/db" }], isDeployed: true, scale: 1 } } } });
    const app = await new RealLiaraClient({ apiToken: "t", fetchImpl: f.fetchImpl }).getApp("shop");
    expect(app?.envKeys).toEqual(["DB_URL"]);
    expect(JSON.stringify(app)).not.toContain("postgres://");
  });

  it("deploys as upload → release, and never retries a POST", async () => {
    const f = fake({
      "POST /v2/projects/shop/sources": { body: { sourceID: "src1" } },
      "POST /v2/projects/shop/releases": { body: { releaseID: "rel1" } },
    });
    const c = new RealLiaraClient({ apiToken: "t", fetchImpl: f.fetchImpl });
    const r = await c.deploy({ app: "shop", sourceDir: path.join(FIX, "node-no-start"), port: 3000, platform: "node" });
    expect(r.releaseId).toBe("rel1");
    expect(f.calls.map((x) => `${x.method} ${x.url.pathname}`)).toEqual(["POST /v2/projects/shop/sources", "POST /v2/projects/shop/releases"]);
    expect(f.calls[0]!.body).toBeInstanceOf(FormData);
    expect(JSON.parse(String(f.calls[1]!.body))).toEqual({ sourceID: "src1", port: 3000, type: "node" });

    const failing = fake({ "POST /v1/projects/shop/actions/restart": { status: 503, body: {} } });
    await expect(new RealLiaraClient({ apiToken: "t", fetchImpl: failing.fetchImpl }).restartApp("shop")).rejects.toThrow(/503/);
    expect(failing.calls).toHaveLength(1);
  });

  it("returns null for a missing app and falls back to the plan table when /v1/me has no catalogue", async () => {
    const f = fake({ "GET /v1/me": { body: { user: {} } } });
    const c = new RealLiaraClient({ apiToken: "t", fetchImpl: f.fetchImpl });
    expect(await c.getApp("nope")).toBeNull();
    const plans = await c.listPlans();
    expect(plans[0]?.verified).toBe(false);
  });

  it("never uploads .env files or node_modules", () => {
    const files = listSourceFiles(path.join(FIX, "demo-shop"));
    expect(files).toContain(".env.example");
    expect(files.some((f) => f === ".env" || f.startsWith("node_modules"))).toBe(false);
  });
});
