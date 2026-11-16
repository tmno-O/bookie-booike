import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

if (existsSync(".env.local")) loadEnvFile(".env.local");

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
