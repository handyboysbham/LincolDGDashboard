import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["tests/integration/**", "**/node_modules/**", "**/dist/**"],
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
  },
});
