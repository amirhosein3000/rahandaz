import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MockLiaraClient } from "../src/mock/mock-client";
import { simulateRelease } from "../src/mock/simulate";
import { snapshotDir } from "../src/mock/snapshot";
import { LiaraRequests, formatCall } from "../src/requests";

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures");
const sim = (name: string, platform: string, port: number, env: Record<string, string> = {}) =>
  simulateRelease({ files: snapshotDir(path.join(FIX, name)), platform, port, env: new Map(Object.entries(env)) });

describe("mock builder simulates each fixture's real failure", () => {
  it("wrong port → UNHEALTHY with probe refused", () => {
    const o = sim("node-wrong-port", "node", 3000);
    expect(o.finalState).toBe("UNHEALTHY");
    expect(o.runtimeLines.join("\n")).toContain("listening on http://0.0.0.0:8080");
    expect(sim("node-wrong-port", "node", 8080).finalState).toBe("READY");
  });
  it("missing start script → crash", () => {
    expect(sim("node-no-start", "node", 3000).runtimeLines[0]).toContain('Missing script: "start"');
  });
  it("Next.js missing env → build FAILED; with it → READY", () => {
    expect(sim("next-missing-env", "next", 3000).finalState).toBe("FAILED");
    expect(sim("next-missing-env", "next", 3000, { API_BASE_URL: "x" }).finalState).toBe("READY");
  });
  it("Flask 2.2 + unpinned Werkzeug → ImportError url_quote", () => {
    expect(sim("python-unpinned", "flask", 80).runtimeLines.join("\n")).toContain("url_quote");
  });
  it("Laravel without APP_KEY → READY but HTTP 500", () => {
    const o = sim("laravel-no-appkey", "laravel", 80);
    expect(o.finalState).toBe("READY");
    expect(o.httpStatus).toBe(500);
    expect(sim("laravel-no-appkey", "laravel", 80, { APP_KEY: "base64:x" }).httpStatus).toBe(200);
  });
  it("bad base image → pull access denied", () => {
    const o = sim("docker-bad-base", "docker", 3000);
    expect(o.finalState).toBe("FAILED");
    expect(o.buildLines.join("\n")).toContain("pull access denied for nodejs");
  });
});

describe("mock client", () => {
  it("streams build logs with a cursor and settles", async () => {
    const c = new MockLiaraClient({ latencyScale: 0 });
    await c.createApp({ name: "shop", platform: "node", planId: "earth" });
    const { releaseId } = await c.deploy({ app: "shop", sourceDir: path.join(FIX, "node-no-start"), port: 3000, platform: "node" });
    const first = await c.getBuildLogs(releaseId);
    expect(first.length).toBeGreaterThan(2);
    expect(await c.getBuildLogs(releaseId, first.at(-1)!.createdAt)).toEqual([]);
    expect((await c.getRelease("shop", releaseId)).state).toBe("UNHEALTHY");
    expect((await c.getApp("shop"))!.status).toBe("crashed");
  });
  it("planned calls match the documented endpoints", () => {
    expect(formatCall(LiaraRequests.restart("shop"))).toBe("POST /v1/projects/shop/actions/restart");
    expect(LiaraRequests.deploy({ app: "shop", sourceDir: "", port: 3000, platform: "node" }).map((c) => c.path)).toEqual(["/v2/projects/shop/sources", "/v2/projects/shop/releases"]);
    expect(JSON.stringify(LiaraRequests.updateEnvs("shop", ["API_KEY"]))).not.toMatch(/"value":"(?!«secret»)/);
  });
});
