import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { RUN_RECOVERY_ACCEPTANCE: "true" },
    fileParallelism: false,
    include: [
      "tests/integration/pricing-estimates-quotes.test.ts",
      "tests/integration/dump-trailer-rental.test.ts",
    ],
    testTimeout: 180_000,
  },
});
