import path from "node:path";
import fs from "node:fs";
import type { NextConfig } from "next";

// One .env at the repo root serves the CLI, tests and the console.
const rootEnv = path.join(import.meta.dirname, "../../.env");
if (fs.existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@rahandaz/core", "@rahandaz/liara"],
  // Self-contained server bundle for the Docker image (dogfooding on Liara).
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  outputFileTracingIncludes: { "/api/**": ["../../fixtures/**", "../../data/liara-docs/**"] },
  serverExternalPackages: ["tar"],
  poweredByHeader: false,
};

export default config;
