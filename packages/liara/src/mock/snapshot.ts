import fs from "node:fs";
import path from "node:path";

/** path (posix, relative) → file content. What "Liara's builder" sees in mock mode. */
export type FileSnapshot = Map<string, string>;

const IGNORED_DIRS = new Set([".git", "node_modules", ".next", "vendor", "__pycache__", ".venv", "venv"]);
const TEXT_EXT = /\.(m?[jt]sx?|cjs|json|py|php|txt|toml|cfg|ini|go|mod|ya?ml|lock|example|conf)$/i;
const NAMED = new Set(["Dockerfile", "Procfile", "artisan", "composer.json", "requirements.txt", "go.mod", "liara.json"]);
const MAX_FILE_BYTES = 200_000;

export function snapshotDir(root: string): FileSnapshot {
  const snap: FileSnapshot = new Map();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile() || !(TEXT_EXT.test(entry.name) || NAMED.has(entry.name))) continue;
      if (fs.statSync(abs).size > MAX_FILE_BYTES) continue;
      snap.set(path.relative(root, abs).split(path.sep).join("/"), fs.readFileSync(abs, "utf8"));
    }
  };
  walk(root);
  return snap;
}
