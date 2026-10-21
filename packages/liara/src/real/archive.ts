import fs from "node:fs";
import path from "node:path";
import * as tar from "tar";

/** Directories never uploaded; the platform rebuilds them (mirrors the CLI's default ignores). */
const ALWAYS_IGNORED = new Set([".git", "node_modules", ".next", "vendor", "__pycache__", ".venv", "venv", ".idea", ".vscode"]);
/** Local secret files must never leave the machine, even if the repo forgot to gitignore them. */
const SECRET_FILES = /^\.env(\..*)?$/;

export function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ALWAYS_IGNORED.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && !(SECRET_FILES.test(entry.name) && entry.name !== ".env.example")) out.push(rel);
    }
  };
  walk(root);
  return out.sort();
}

export async function createSourceArchive(sourceDir: string, outFile: string): Promise<void> {
  const files = listSourceFiles(sourceDir);
  if (files.length === 0) throw new Error(`No files to upload in ${sourceDir}`);
  await tar.c({ gzip: true, cwd: sourceDir, file: outFile, portable: true }, files);
}
