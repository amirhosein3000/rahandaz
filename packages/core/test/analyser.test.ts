import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyseFiles, analyseRepo } from "../src/analyser/analyse";
import { ROOT } from "./helpers";

const fx = (name: string) => analyseRepo(path.join(ROOT, "fixtures", name));
const files = (o: Record<string, string>) => new Map(Object.entries(o));

describe("analyser detectors on fixtures", () => {
  it("node-wrong-port: port from liara.json, conflict with code flagged", () => {
    const a = fx("node-wrong-port");
    expect(a.platform).toBe("node");
    expect(a.port).toBe(3000);
    expect(a.portSource).toBe("liara.json");
    expect(a.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["port_conflict", "injection_text"]));
    expect(a.injection[0]!.file).toBe("README.md");
  });

  it("node-no-start: no start script flagged", () => {
    const a = fx("node-no-start");
    expect(a.startCommand).toBeNull();
    expect(a.warnings.map((w) => w.code)).toContain("no_start_script");
    expect(a.port).toBe(3000);
  });

  it("next-missing-env: Next.js detected; env from .env.example only (helper-wrapped one is missed, as in real life)", () => {
    const a = fx("next-missing-env");
    expect(a.platform).toBe("next");
    expect(a.framework).toBe("Next.js 15");
    expect(a.buildCommand).toBe("npm run build");
    expect(a.env.map((e) => e.name)).toEqual(["NEXT_PUBLIC_SITE_NAME"]);
  });

  it("python-unpinned: Flask, default port 80, unpinned deps flagged, Persian injection found", () => {
    const a = fx("python-unpinned");
    expect(a.platform).toBe("flask");
    expect(a.port).toBe(80);
    expect(a.warnings.find((w) => w.code === "unpinned_dependencies")?.messageFa).toContain("gunicorn");
    expect(a.injection.map((i) => i.file)).toContain("app.py");
  });

  it("laravel-no-appkey: Laravel on port 80", () => {
    const a = fx("laravel-no-appkey");
    expect(a.platform).toBe("laravel");
    expect(a.language).toBe("php");
    expect(a.port).toBe(80);
  });

  it("docker-bad-base: Docker, EXPOSE port, unknown base image flagged", () => {
    const a = fx("docker-bad-base");
    expect(a.platform).toBe("docker");
    expect(a.port).toBe(3000);
    expect(a.portSource).toBe("Dockerfile");
    expect(a.warnings.map((w) => w.code)).toContain("unknown_base_image");
  });

  it("demo-shop: secret env var gets a server-side generator, never a user prompt", () => {
    const a = fx("demo-shop");
    expect(a.env).toEqual([expect.objectContaining({ name: "SESSION_SECRET", secret: true, suggestedRef: "generate:secret" })]);
    expect(a.warnings).toEqual([expect.objectContaining({ code: "no_lockfile" })]);
  });
});

describe("analyser detectors on synthetic repos", () => {
  it("detects databases and disks", () => {
    const a = analyseFiles(files({ "package.json": JSON.stringify({ scripts: { start: "node a.js" }, dependencies: { pg: "8", multer: "1" } }), "package-lock.json": "{}" }));
    expect(a.database).toMatchObject({ needed: true, kind: "postgres" });
    expect(a.disk.needed).toBe(true);
  });

  it("detects Django and Go platforms, Go port from code", () => {
    expect(analyseFiles(files({ "requirements.txt": "Django==5.0\n" })).platform).toBe("django");
    const go = analyseFiles(files({ "go.mod": "module x", "main.go": 'http.ListenAndServe(":9090", nil)' }));
    expect(go.platform).toBe("go");
    expect(go.port).toBe(9090);
  });

  it("never puts env example VALUES into the analysis", () => {
    const a = analyseFiles(files({ "package.json": "{}", ".env.example": "STRIPE_KEY=sk_test_not_for_llm\nPORT=3000\n" }));
    expect(JSON.stringify(a)).not.toContain("sk_test_not_for_llm");
    expect(a.env.map((e) => e.name)).toEqual(["STRIPE_KEY"]);
  });

  it("flags committed .env files", () => {
    const a = analyseFiles(files({ "package.json": "{}", ".env": "X=1" }));
    expect(a.warnings.map((w) => w.code)).toContain("secret_file_committed");
  });
});

describe("env defaults from .env.example", () => {
  it("non-secret keys with an example value default to it; secrets never do", () => {
    const a = analyseFiles(files({ "composer.json": JSON.stringify({ require: { "laravel/framework": "^11" } }), ".env.example": "APP_ENV=production\nAPP_DEBUG=false\nDB_PASSWORD=changeme\nMAIL_HOST=\n" }));
    const ref = Object.fromEntries(a.env.map((e) => [e.name, e.suggestedRef]));
    expect(ref).toEqual({ APP_ENV: "example", APP_DEBUG: "example", DB_PASSWORD: "user", MAIL_HOST: "user" });
  });
});
