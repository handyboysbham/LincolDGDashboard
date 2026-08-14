import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat, unlink } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const backupEnvelopeMagic = Buffer.from("LDGBAK1\0", "ascii");
const ivBytes = 12;
const tagBytes = 16;

export async function encryptBackupFile(input: {
  destinationPath: string;
  key: Buffer;
  sourcePath: string;
}): Promise<void> {
  assertKey(input.key);
  const iv = randomBytes(ivBytes);
  const cipher = createCipheriv("aes-256-gcm", input.key, iv);
  const envelope = new Transform({
    flush(callback) {
      this.push(cipher.getAuthTag());
      callback();
    },
    transform(chunk, _encoding, callback) {
      this.push(chunk);
      callback();
    },
  });
  const destination = createWriteStream(input.destinationPath, { flags: "wx", mode: 0o600 });
  destination.write(Buffer.concat([backupEnvelopeMagic, iv]));
  await pipeline(createReadStream(input.sourcePath), cipher, envelope, destination);
}

export async function decryptBackupFile(input: {
  destinationPath: string;
  encryptedPath: string;
  key: Buffer;
}): Promise<void> {
  assertKey(input.key);
  const size = (await stat(input.encryptedPath)).size;
  const headerBytes = backupEnvelopeMagic.byteLength + ivBytes;
  if (size <= headerBytes + tagBytes) throw new Error("Encrypted backup envelope is truncated");
  const handle = await open(input.encryptedPath, "r");
  try {
    const header = Buffer.alloc(headerBytes);
    const tag = Buffer.alloc(tagBytes);
    await handle.read(header, 0, header.byteLength, 0);
    await handle.read(tag, 0, tag.byteLength, size - tagBytes);
    if (!header.subarray(0, backupEnvelopeMagic.byteLength).equals(backupEnvelopeMagic)) {
      throw new Error("Encrypted backup envelope has an invalid format");
    }
    const iv = header.subarray(backupEnvelopeMagic.byteLength);
    const decipher = createDecipheriv("aes-256-gcm", input.key, iv);
    decipher.setAuthTag(tag);
    try {
      await pipeline(
        createReadStream(input.encryptedPath, { end: size - tagBytes - 1, start: headerBytes }),
        decipher,
        createWriteStream(input.destinationPath, { flags: "wx", mode: 0o600 }),
      );
    } catch (error) {
      await unlink(input.destinationPath).catch(() => undefined);
      throw error;
    }
  } finally {
    await handle.close();
  }
}

function assertKey(key: Buffer): void {
  if (key.byteLength !== 32) throw new Error("Backup encryption key must contain 32 bytes");
}
