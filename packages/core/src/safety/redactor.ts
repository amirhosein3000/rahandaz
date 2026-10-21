/**
 * Secret redaction. Applied at every boundary where text leaves the trusted
 * core: messages to the LLM, events to the UI / bot, the audit log, and the
 * console log. Two layers:
 *   1. exact values we know are secret (tokens from config, vault values);
 *   2. patterns for secrets we were never told about (a token in a build log,
 *      a connection string in a README, KEY=value lines).
 */

export const REDACTED = "«redacted»";

const PATTERNS: Array<[RegExp, string]> = [
  // Authorization headers / bearer tokens.
  [/\b(Bearer|Token)\s+[A-Za-z0-9._~+/=-]{12,}/g, `$1 ${REDACTED}`],
  // JWTs.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
  // Credentials inside URLs: scheme://user:pass@host
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, `$1${REDACTED}@`],
  // Well-known token prefixes (GitHub, OpenAI-style, Slack, AWS access keys).
  [/\b(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{16,}/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  // Laravel-style keys.
  [/\bbase64:[A-Za-z0-9+/]{20,}={0,2}/g, REDACTED],
  // PEM private keys.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED],
  // NAME=value / NAME: value where NAME looks secret.
  [
    /\b([A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PASS|API_?KEY|APP_KEY|PRIVATE_KEY|ACCESS_KEY|CREDENTIALS?|DSN|DATABASE_URL|CONNECTION_STRING)[A-Za-z0-9_]*)(\s*[=:]\s*)(["']?)(?!«)[^\s"'`,;]{3,}\3/gi,
    `$1$2$3${REDACTED}$3`,
  ],
  // JSON fields: "password": "..."
  [/("[^"\n]*(?:secret|token|password|passwd|api[_-]?key|apikey|private[_-]?key)[^"\n]*"\s*:\s*)"(?!«)[^"\n]*"/gi, `$1"${REDACTED}"`],
];

export class Redactor {
  private secrets: string[] = [];

  /** Register an exact secret value. Short values are ignored (would over-redact). */
  addSecret(value: string | undefined | null): void {
    if (!value || value.length < 6 || this.secrets.includes(value)) return;
    this.secrets.push(value);
    // Longest first so a secret containing another is fully replaced.
    this.secrets.sort((a, b) => b.length - a.length);
  }

  redact(text: string): string {
    if (!text) return text;
    let out = text;
    for (const s of this.secrets) {
      if (out.includes(s)) out = out.split(s).join(REDACTED);
    }
    for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
    return out;
  }

  /** Deep-redact any JSON-like value. Keys that look secret have their values replaced outright. */
  redactDeep<T>(value: T): T {
    return this.walk(value, 0) as T;
  }

  private walk(value: unknown, depth: number): unknown {
    if (depth > 12) return "[depth limit]";
    if (typeof value === "string") return this.redact(value);
    if (Array.isArray(value)) return value.map((v) => this.walk(v, depth + 1));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = SECRET_KEY.test(k) && typeof v === "string" && v !== "" ? REDACTED : this.walk(v, depth + 1);
      }
      return out;
    }
    return value;
  }
}

/** Object keys whose string values are always secret. `key` alone is NOT here: env var *names* are fine. */
const SECRET_KEY = /^(value|secret|token|password|passwd|apiKey|api_key|authorization|connectionString)$/i;
