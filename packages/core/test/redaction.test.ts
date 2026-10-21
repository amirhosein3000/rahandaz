import { describe, expect, it } from "vitest";
import { REDACTED, Redactor } from "../src/safety/redactor";
import { SecretVault } from "../src/safety/vault";

describe("secret redaction", () => {
  const r = new Redactor();
  r.addSecret("liara_tok_9f8e7d6c5b4a3210");

  it("removes registered secret values wherever they appear", () => {
    expect(r.redact("token=liara_tok_9f8e7d6c5b4a3210 used")).not.toContain("9f8e7d6c5b4a3210");
    expect(r.redact("prefix liara_tok_9f8e7d6c5b4a3210suffix")).toContain(REDACTED);
  });

  it.each([
    ["Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456", "abcdefghijklmnop"],
    ["DATABASE_URL=postgres://admin:hunter2pass@db.example:5432/app", "hunter2pass"],
    ["connecting to mongodb://user:p4ssw0rd@mongo:27017", "p4ssw0rd"],
    ["export STRIPE_SECRET_KEY=sk_live_51HxYzAbCdEf", "sk_live_51HxYzAbCdEf"],
    ["APP_KEY=base64:2fl+Ktvkfl+Fuz4Qp/A75G2RTiWVA/ZoKZvp6fiiM10=", "2fl+Ktvkfl"],
    ["GITHUB_TOKEN: ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345", "ghp_aBcDeFgHiJkLmNoP"],
    ["key sk-proj-AbCdEfGhIjKlMnOpQrStUv", "sk-proj-AbCdEfGhIjKl"],
    ['{"password": "s3cr3t-value"}', "s3cr3t-value"],
    ["jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U", "dozjgNryP4J3"],
  ])("pattern-redacts %s", (input, secret) => {
    const out = r.redact(input);
    expect(out).not.toContain(secret);
    expect(out).toContain(REDACTED);
  });

  it("keeps env var NAMES and harmless text intact", () => {
    expect(r.redact("Missing required environment variable: SESSION_SECRET")).toBe("Missing required environment variable: SESSION_SECRET");
    expect(r.redact("set API_BASE_URL and APP_KEY on the app")).toBe("set API_BASE_URL and APP_KEY on the app");
    expect(r.redact("Server listening on http://0.0.0.0:8080")).toBe("Server listening on http://0.0.0.0:8080");
  });

  it("deep-redacts objects, including value-like keys", () => {
    const out = r.redactDeep({ vars: [{ key: "API_KEY", value: "plain-secret-123" }], note: "liara_tok_9f8e7d6c5b4a3210" });
    expect(JSON.stringify(out)).not.toContain("plain-secret-123");
    expect(JSON.stringify(out)).not.toContain("9f8e7d6c5b4a3210");
    expect(out.vars[0]!.key).toBe("API_KEY");
  });
});

describe("secret vault", () => {
  it("resolves refs to values only server-side, and registers them for redaction", () => {
    const red = new Redactor();
    const vault = new SecretVault(red);
    vault.putUserValue("API_BASE_URL", "https://internal.example/api?k=zzzz9999");
    expect(vault.resolve("API_BASE_URL", "user:API_BASE_URL")).toBe("https://internal.example/api?k=zzzz9999");
    expect(red.redact("calling https://internal.example/api?k=zzzz9999")).not.toContain("zzzz9999");

    const appKey = vault.resolve("APP_KEY", "generate:laravel_app_key");
    expect(appKey).toMatch(/^base64:[A-Za-z0-9+/]{43}=$/);
    expect(red.redact(`key is ${appKey}`)).not.toContain(appKey);

    const secret = vault.resolve("SESSION_SECRET", "generate:secret");
    expect(secret).toMatch(/^[a-f0-9]{48}$/);
    expect(red.redact(secret)).toBe(REDACTED);
  });

  it("refuses literal values for secret-looking keys and unknown ref kinds", () => {
    expect(() => SecretVault.validateRef("DB_PASSWORD", "literal:hunter2")).toThrow();
    expect(() => SecretVault.validateRef("API_KEY", "literal:abc")).toThrow();
    expect(() => SecretVault.validateRef("PORT", "literal:3000")).not.toThrow();
    expect(() => SecretVault.validateRef("X", "env:X")).toThrow();
    expect(() => new SecretVault(new Redactor()).resolve("TOKEN", "user:TOKEN")).toThrow(/no value/);
  });
});

describe("example: refs", () => {
  it("resolve from .env.example for non-secret keys only", () => {
    const vault = new SecretVault(new Redactor());
    expect(vault.resolve("APP_ENV", "example:APP_ENV", () => "production")).toBe("production");
    expect(() => SecretVault.validateRef("DB_PASSWORD", "example:DB_PASSWORD")).toThrow(/secret/);
    expect(() => SecretVault.validateRef("APP_ENV", "example:OTHER")).toThrow();
    expect(() => vault.resolve("APP_ENV", "example:APP_ENV", () => undefined)).toThrow();
  });
});
