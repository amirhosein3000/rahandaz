/**
 * Per-run working copy of the user's repo. The agent analyses, patches and
 * deploys this copy; the original (GitHub or fixture) is never modified.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Workspace {
  dir: string;
  /** What the user gave us, normalised (e.g. "https://github.com/acme/shop"). */
  origin: string;
  /** Repo name, used to suggest the app name. */
  name: string;
  kind: "fixture" | "github";
  commit: string | null;
}

const GITHUB_RE = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/;
const FIXTURE_RE = /^fixture:([a-z0-9-]{2,64})$/;

export class WorkspaceError extends Error {}

/** Extract the first repo reference from free text (a chat message). */
export function findRepoRef(text: string): string | null {
  const gh = text.match(/https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}/);
  if (gh) return gh[0].replace(/[.,)،]+$/, "");
  const fx = text.match(/fixture:[a-z0-9-]{2,64}/);
  return fx ? fx[0] : null;
}

export interface AcquireOptions {
  fixturesDir: string;
  workspacesDir: string;
  runId: string;
  /** In mock mode a github.com/<anyone>/<fixture-name> link resolves to the local fixture (offline demos). */
  mapGithubToFixtures: boolean;
}

export async function acquireRepo(source: string, opts: AcquireOptions): Promise<Workspace> {
  const src = source.trim();
  const fixture = src.match(FIXTURE_RE)?.[1];
  const gh = src.match(GITHUB_RE);
  const dest = path.join(opts.workspacesDir, opts.runId);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const fixtureName = fixture ?? (gh && opts.mapGithubToFixtures ? gh[2] : undefined);
  if (fixtureName && fs.existsSync(path.join(opts.fixturesDir, fixtureName, "."))) {
    fs.cpSync(path.join(opts.fixturesDir, fixtureName), dest, { recursive: true });
    return { dir: dest, origin: gh ? `https://github.com/${gh[1]}/${gh[2]}` : `fixture:${fixtureName}`, name: fixtureName, kind: "fixture", commit: null };
  }
  if (fixture) throw new WorkspaceError(`fixture "${fixture}" not found`);
  if (!gh) throw new WorkspaceError("only public https://github.com/<owner>/<repo> links (or fixture:<name>) are supported");

  const url = `https://github.com/${gh[1]}/${gh[2]}.git`;
  try {
    // execFile with an argument array: no shell, so the URL cannot inject commands.
    await run("git", ["clone", "--depth", "1", "--single-branch", "--no-tags", url, dest], {
      timeout: 120_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  } catch (err) {
    throw new WorkspaceError(`git clone failed for ${url}: ${(err as Error).message.split("\n")[0]}`);
  }
  let commit: string | null = null;
  try {
    commit = (await run("git", ["-C", dest, "rev-parse", "--short", "HEAD"])).stdout.trim();
  } catch {
    commit = null;
  }
  return { dir: dest, origin: `https://github.com/${gh[1]}/${gh[2]}`, name: gh[2]!, kind: "github", commit };
}

/** Resolve a repo-relative path inside the workspace, refusing anything that escapes it. */
export function safeJoin(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  const rootAbs = path.resolve(root);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) throw new WorkspaceError(`path escapes the workspace: ${rel}`);
  return abs;
}
