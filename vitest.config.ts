import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts", "apps/*/src/**/*.test.ts", "apps/web/lib/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    env: { MOCK_LATENCY_SCALE: "0", RAHANDAZ_DATA_DIR: "var/test" },
  },
});
