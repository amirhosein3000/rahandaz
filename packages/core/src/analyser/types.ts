import type { Platform } from "@rahandaz/liara";
import type { InjectionFinding } from "../safety/untrusted";

export type SuggestedRef = "user" | "generate:secret" | "generate:laravel_app_key";

export interface EnvVarNeed {
  name: string;
  /** Where we saw it: ".env.example", "lib/config.ts", ... */
  source: string;
  secret: boolean;
  suggestedRef: SuggestedRef;
}

export interface AnalysisWarning {
  code:
    | "port_conflict"
    | "no_start_script"
    | "unpinned_dependencies"
    | "unknown_base_image"
    | "no_lockfile"
    | "secret_file_committed"
    | "injection_text";
  messageFa: string;
  file?: string;
}

export interface RepoAnalysis {
  /** Short human label, e.g. "Next.js 15", "Flask (Python)". */
  stackLabel: string;
  platform: Platform;
  language: "javascript" | "typescript" | "python" | "php" | "go" | "other";
  framework: string | null;
  port: number;
  portSource: "liara.json" | "Dockerfile" | "code" | "Procfile" | "platform-default";
  portEvidence: string[];
  buildCommand: string | null;
  startCommand: string | null;
  env: EnvVarNeed[];
  database: { needed: boolean; kind: string | null; evidence: string | null };
  disk: { needed: boolean; evidence: string | null };
  /** liara.json, if present (only non-secret config fields). */
  liaraJson: { platform?: string; port?: number; app?: string } | null;
  warnings: AnalysisWarning[];
  injection: Array<{ file: string; findings: InjectionFinding[] }>;
  filesScanned: number;
  detectorsFired: string[];
}
