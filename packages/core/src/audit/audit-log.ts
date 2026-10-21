/**
 * Append-only audit log: one JSON object per line, hash-chained so that any
 * edit or deletion of an earlier line is detectable (`verify()`).
 * Every entry is redacted before it is written.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Redactor } from "../safety/redactor";

export type AuditActor = `user:${string}` | "agent" | "system";

export type AuditResult =
  | "ok"
  | "error"
  | "requested"
  | "approved"
  | "denied"
  | "blocked"
  | "dry_run"
  | "info";

export interface AuditInput {
  actor: AuditActor;
  action: string;
  runId?: string;
  tool?: string;
  kind?: "read" | "mutating" | "destructive" | "plan";
  resource?: string;
  args?: unknown;
  result: AuditResult;
  detail?: string;
}

export interface AuditEntry extends AuditInput {
  seq: number;
  ts: string;
  prevHash: string;
  hash: string;
}

const GENESIS = "0".repeat(64);

export class AuditLog {
  private seq = 0;
  private lastHash = GENESIS;
  private readonly file: string;

  constructor(
    dataDir: string,
    private readonly redactor: Redactor,
  ) {
    const dir = path.join(dataDir, "audit");
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "audit.jsonl");
    this.loadTail();
  }

  private loadTail() {
    if (!fs.existsSync(this.file)) return;
    const lines = fs.readFileSync(this.file, "utf8").trim().split("\n").filter(Boolean);
    const last = lines[lines.length - 1];
    if (!last) return;
    const entry = JSON.parse(last) as AuditEntry;
    this.seq = entry.seq;
    this.lastHash = entry.hash;
  }

  append(input: AuditInput): AuditEntry {
    // Another process (bot, CLI) may have appended since we last wrote.
    this.loadTail();
    const body = this.redactor.redactDeep({ ...input });
    const entry: Omit<AuditEntry, "hash"> = { seq: this.seq + 1, ts: new Date().toISOString(), ...body, prevHash: this.lastHash };
    const hash = sha256(JSON.stringify(entry));
    const full: AuditEntry = { ...entry, hash };
    fs.appendFileSync(this.file, JSON.stringify(full) + "\n", { encoding: "utf8", flag: "a" });
    this.seq = full.seq;
    this.lastHash = hash;
    return full;
  }

  list(opts: { limit?: number; runId?: string } = {}): AuditEntry[] {
    if (!fs.existsSync(this.file)) return [];
    let entries = fs
      .readFileSync(this.file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as AuditEntry);
    if (opts.runId) entries = entries.filter((e) => e.runId === opts.runId);
    return entries.slice(-(opts.limit ?? 500)).reverse();
  }

  /** Recompute the chain. Returns the first broken seq, or null if intact. */
  verify(): { ok: boolean; brokenAt: number | null; count: number } {
    if (!fs.existsSync(this.file)) return { ok: true, brokenAt: null, count: 0 };
    let prev = GENESIS;
    const lines = fs.readFileSync(this.file, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      const { hash, ...rest } = JSON.parse(line) as AuditEntry;
      if (rest.prevHash !== prev || sha256(JSON.stringify(rest)) !== hash) return { ok: false, brokenAt: rest.seq, count: lines.length };
      prev = hash;
    }
    return { ok: true, brokenAt: null, count: lines.length };
  }
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}
