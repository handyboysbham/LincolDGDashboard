import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as { dependencies?: Record<string, string> };

describe("web architecture boundary", () => {
  it("uses the API client without database runtime dependencies", () => {
    expect(packageJson.dependencies).toHaveProperty("@ldg/api-client");
    expect(packageJson.dependencies).not.toHaveProperty("@ldg/database");
    expect(packageJson.dependencies).not.toHaveProperty("drizzle-orm");
    expect(packageJson.dependencies).not.toHaveProperty("pg");

    for (const file of sourceFiles(webRoot)) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/from ["'](?:@ldg\/database|drizzle-orm|pg)["']/u);
    }
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(entry.name)) && !entry.name.endsWith(".test.ts")
      ? [path]
      : [];
  });
}
