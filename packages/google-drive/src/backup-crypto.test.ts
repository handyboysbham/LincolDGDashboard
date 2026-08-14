import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { decryptBackupFile, encryptBackupFile } from "./backup-crypto.js";

const directories: string[] = [];
afterEach(async () =>
  Promise.all(directories.splice(0).map((path) => rm(path, { force: true, recursive: true }))),
);

describe("encrypted backup envelopes", () => {
  it("round trips backup bytes with AES-256-GCM", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ldg-backup-test-"));
    directories.push(directory);
    const source = join(directory, "source.tar.gz");
    const encrypted = join(directory, "source.tar.gz.ldgenc");
    const restored = join(directory, "restored.tar.gz");
    const content = randomBytes(128 * 1024);
    const key = randomBytes(32);
    await writeFile(source, content);

    await encryptBackupFile({ destinationPath: encrypted, key, sourcePath: source });
    await decryptBackupFile({ destinationPath: restored, encryptedPath: encrypted, key });

    expect(await readFile(restored)).toEqual(content);
    expect((await readFile(encrypted)).equals(content)).toBe(false);
  });

  it("rejects tampered backup ciphertext", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ldg-backup-test-"));
    directories.push(directory);
    const source = join(directory, "source.tar.gz");
    const encrypted = join(directory, "source.tar.gz.ldgenc");
    const restored = join(directory, "restored.tar.gz");
    const key = randomBytes(32);
    await writeFile(source, randomBytes(1024));
    await encryptBackupFile({ destinationPath: encrypted, key, sourcePath: source });
    const bytes = await readFile(encrypted);
    bytes[32] = (bytes[32] ?? 0) ^ 1;
    await writeFile(encrypted, bytes);

    await expect(
      decryptBackupFile({ destinationPath: restored, encryptedPath: encrypted, key }),
    ).rejects.toThrow();
  });
});
