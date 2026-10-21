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

/** The CLI refuses sources above 256 MiB (`MAX_SOURCE_SIZE`, @liara/cli constants); so do we. */
export const MAX_SOURCE_BYTES = 256 * 1024 * 1024;

export async function createSourceArchive(sourceDir: string, outFile: string): Promise<void> {
  const files = listSourceFiles(sourceDir);
  if (files.length === 0) throw new Error(`No files to upload in ${sourceDir}`);
  await tar.c({ gzip: true, cwd: sourceDir, file: outFile, portable: true }, files);
  const size = fs.statSync(outFile).size;
  if (size > MAX_SOURCE_BYTES) {
    throw new Error(`source archive is ${Math.round(size / 1048576)} MiB; Liara accepts at most 256 MiB (add large files to .gitignore)`);
  }
}
