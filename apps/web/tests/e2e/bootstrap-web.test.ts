import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const port = 3107;
const origin = `http://127.0.0.1:${port.toString()}`;
let server: ChildProcess | undefined;
let serverOutput = "";

describe("BOOT-E2E-001 web startup", () => {
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

  it.each([
    ["/", "Good morning, Kaleb."],
    ["/customers", "Accounts, contacts, service locations"],
    ["/leads", "Every request from first call"],
    ["/leads/new", "Capture a complete Lead"],
    ["/leads/00000000-0000-4000-8000-000000000999", "Loading Lead"],
    ["/pricing", "Loading pricing"],
    ["/estimates", "Loading Estimates"],
    ["/estimates/00000000-0000-4000-8000-000000000999", "Loading Estimate"],
    ["/quotes", "Loading Quotes"],
    ["/quotes/00000000-0000-4000-8000-000000000999", "Loading Quote"],
    ["/driver", "Your road is clear."],
    ["/customer/documents/not-a-token", "Checking your link"],
    ["/customer/quotes/not-a-token", "Checking your offer"],
  ])("serves %s", async (path, expected) => {
    const response = await fetch(`${origin}${path}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(expected);
  });
});

async function waitForHealthyServer(): Promise<void> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Next.js exited before startup:\n${serverOutput}`);
    }
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // The process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Next.js did not become ready:\n${serverOutput}`);
}
