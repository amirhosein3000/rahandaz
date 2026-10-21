/**
 * Secret vault for env var values.
 *
 * The LLM only ever handles *references*:
 *   - `user:NAME`          the user typed the value into an approval card / bot DM
 *   - `generate:secret`    48 random hex chars, generated here
 *   - `generate:laravel_app_key`  "base64:" + 32 random bytes (what `php artisan key:generate` writes)
 *   - `example:KEY`        the non-secret value in the repo's .env.example (read here, never by the LLM).
 *                          Refused for secret-looking keys: their example values are placeholders.
 *   - `literal:VALUE`      only for non-secret values the user typed in chat. Refused for secret-looking keys.
 *
 * Values are resolved only inside the tool executor, right before the Liara
 * call, and every value is registered with the redactor first.
 */
import crypto from "node:crypto";
import type { Redactor } from "./redactor";

export type ValueRef = string;

const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|PASS|KEY|PRIVATE|CREDENTIAL|DSN|DATABASE_URL|_URL$|URI)/i;

export class VaultError extends Error {}

export class SecretVault {
  private values = new Map<string, string>();

  constructor(private readonly redactor: Redactor) {}

  /** Store a user-provided value (from the approval channel, never from the LLM). */
  putUserValue(name: string, value: string): void {
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(name)) throw new VaultError(`invalid env var name: ${name}`);
    this.redactor.addSecret(value);
    this.values.set(name, value);
  }

  hasUserValue(name: string): boolean {
    return this.values.has(name);
  }

  /** Refs that need user input before the action can run. */
  static missingUserRefs(refs: Array<{ key: string; valueRef: ValueRef }>, vault: SecretVault): string[] {
    return refs.filter((r) => r.valueRef.startsWith("user:") && !vault.hasUserValue(r.valueRef.slice(5))).map((r) => r.key);
  }

  static validateRef(key: string, ref: ValueRef): void {
    if (ref.startsWith("user:")) {
      if (!/^user:[A-Z_][A-Z0-9_]*$/i.test(ref)) throw new VaultError(`bad value reference for ${key}`);
      return;
    }
    if (ref === "generate:secret" || ref === "generate:laravel_app_key") return;
    if (ref.startsWith("example:")) {
      if (ref !== `example:${key}`) throw new VaultError(`example reference must name its own key (example:${key})`);
      if (SECRET_NAME.test(key)) throw new VaultError(`${key} looks secret; its .env.example value is only a placeholder. Use user:${key} or a generate: reference`);
      return;
    }
    if (ref.startsWith("literal:")) {
      if (SECRET_NAME.test(key)) throw new VaultError(`${key} looks secret; use user:${key} or a generate: reference, never a literal`);
      if (ref.length > 512) throw new VaultError("literal too long");
      return;
    }
    throw new VaultError(`unknown value reference "${ref}" for ${key} (use user:NAME, generate:secret, generate:laravel_app_key, example:NAME or literal:VALUE)`);
  }

  /** Resolve a reference to the real value. Only the tool executor calls this. */
  resolve(key: string, ref: ValueRef, exampleValue?: (key: string) => string | undefined): string {
    SecretVault.validateRef(key, ref);
    if (ref.startsWith("example:")) {
      const v = exampleValue?.(key);
      if (v === undefined || v === "") throw new VaultError(`no example value for ${key} in .env.example`);
      return v;
    }
    let value: string;
    if (ref.startsWith("user:")) {
      const v = this.values.get(ref.slice(5));
      if (v === undefined) throw new VaultError(`no value provided for ${key}; the user must enter it in the approval card`);
      value = v;
    } else if (ref === "generate:secret") {
      value = crypto.randomBytes(24).toString("hex");
    } else if (ref === "generate:laravel_app_key") {
      value = "base64:" + crypto.randomBytes(32).toString("base64");
    } else {
      value = ref.slice("literal:".length);
      return value; // non-secret by validation; not registered (would over-redact common words)
    }
    this.redactor.addSecret(value);
    return value;
  }

  /** Human-readable description for approval cards (never the value). */
  static describeRef(ref: ValueRef): { kind: "user" | "generated" | "literal" | "example"; labelFa: string } {
    if (ref.startsWith("example:")) return { kind: "example", labelFa: "مقدار نمونه‌ی .env.example مخزن" };
    if (ref.startsWith("user:")) return { kind: "user", labelFa: "مقدار را خودتان وارد می‌کنید (به مدل زبانی نمی‌رسد)" };
    if (ref === "generate:laravel_app_key") return { kind: "generated", labelFa: "کلید تصادفی Laravel، روی سرور ساخته می‌شود" };
    if (ref === "generate:secret") return { kind: "generated", labelFa: "مقدار تصادفی امن، روی سرور ساخته می‌شود" };
    return { kind: "literal", labelFa: `مقدار ثابت: ${ref.slice("literal:".length)}` };
  }
}
