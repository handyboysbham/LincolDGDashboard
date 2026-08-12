import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const port = 3108;
const origin = `http://127.0.0.1:${port.toString()}`;
let server: ChildProcess | undefined;
let serverOutput = "";

describe("AUTH-E2E-001 production web boundary", () => {
  beforeAll(async () => {
    const nextBinary = fileURLToPath(
      new URL("../../node_modules/next/dist/bin/next", import.meta.url),
    );
    server = spawn(
      process.execPath,
      [nextBinary, "start", "--hostname", "127.0.0.1", "--port", port.toString()],
      {
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    server.stdout?.on("data", (chunk: Buffer) => {
      serverOutput += chunk.toString();
    });
    server.stderr?.on("data", (chunk: Buffer) => {
      serverOutput += chunk.toString();
    });
    await waitForHealthyServer();
  });

  afterAll(() => {
    server?.kill("SIGTERM");
  });

  it("serves an accessible sign-in surface with production security headers", async () => {
    const response = await fetch(`${origin}/sign-in`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Sign in to operations");
    expect(body).toContain('autoComplete="username"');
    expect(body).toContain('autoComplete="current-password"');
    expect(response.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
  });

  it("redirects protected staff routes to a bounded return path", async () => {
    const response = await fetch(`${origin}/settings?tab=users`, { redirect: "manual" });
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "", origin);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe("/settings?tab=users");
  });

  it("keeps capability-scoped customer routes public", async () => {
    const response = await fetch(`${origin}/customer/projects/not-a-token`, {
      redirect: "manual",
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Loading your Project");
  });
});

async function waitForHealthyServer(): Promise<void> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Next.js exited before startup:\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${origin}/sign-in`);
      if (response.ok) return;
    } catch {
      // The process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Next.js did not become ready:\n${serverOutput}`);
}
