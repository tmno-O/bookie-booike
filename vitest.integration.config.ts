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
    // Older suites drive table bookings without a queue ticket; the guard itself is covered by unit tests.
    env: { DIRECT_BOOKING_ENABLED: "true" },
  },
});
