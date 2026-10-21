import crypto from "node:crypto";

/** Canonical JSON: object keys sorted, so equal args always hash the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Identity of one exact action: tool name + canonical args. Approvals are bound to it. */
export function fingerprint(tool: string, args: unknown): string {
  return crypto.createHash("sha256").update(`${tool}\n${canonicalJson(args)}`).digest("hex").slice(0, 32);
}
