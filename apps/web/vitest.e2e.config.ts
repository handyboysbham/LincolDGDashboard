import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 30_000,
    include: ["tests/e2e/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
