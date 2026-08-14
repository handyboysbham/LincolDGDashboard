import { createHash } from "node:crypto";
import { createReadStream, openAsBlob } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { basename } from "node:path";

import { encryptBackupFile } from "./backup-crypto.js";
import { GoogleDriveClient } from "./google-drive-client.js";

const archivePath = required("BACKUP_ARCHIVE_PATH");
const backupName = nonEmpty(process.env.BACKUP_NAME) ?? basename(archivePath);
const encryptedPath = `${archivePath}.ldgenc`;
const key = decodeKey(required("DATABASE_BACKUP_ENCRYPTION_KEY_BASE64"));

try {
  await encryptBackupFile({ destinationPath: encryptedPath, key, sourcePath: archivePath });

  const sha256 = await fileSha256(encryptedPath);
  const encryptedBlob = await openAsBlob(encryptedPath, { type: "application/octet-stream" });
  const client = new GoogleDriveClient({
    privateKey: decodePrivateKey(
      required("GOOGLE_DRIVE_BACKUP_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64"),
    ),
    serviceAccountEmail: required("GOOGLE_DRIVE_BACKUP_SERVICE_ACCOUNT_EMAIL"),
  });
  const sharedDriveId = required("GOOGLE_DRIVE_BACKUP_SHARED_DRIVE_ID");
  const backupFolderId = required("GOOGLE_DRIVE_BACKUP_FOLDER_ID");
  await client.assertWritableFolder(backupFolderId, sharedDriveId);
  const fileId = await client.generateFileId();
  const file = await client.uploadBlob({
    appProperties: {
      encryption: "aes-256-gcm-v1",
      purpose: "supabase-database-backup",
      sha256,
    },
    blob: encryptedBlob,
    fileId,
    filename: `${backupName}.ldgenc`,
    mediaType: "application/octet-stream",
    parentFolderId: backupFolderId,
  });
  const revision = await client.keepLatestRevision(file.id);
  const permissions = await client.listPermissions(file.id);
  const encryptedSize = (await stat(encryptedPath)).size;
  if (
    file.trashed ||
    file.driveId !== sharedDriveId ||
    Number(file.size) !== encryptedSize ||
    !revision.keepForever ||
    permissions.some((permission) => permission.type === "anyone")
  ) {
    throw new Error("Encrypted backup did not pass Google Drive retention validation");
  }
  console.log(
    `Encrypted Supabase backup uploaded; file ${file.id}; revision ${revision.id}; sha256 ${sha256}`,
  );
} finally {
  await unlink(encryptedPath).catch(() => undefined);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function decodeKey(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.byteLength !== 32) {
    throw new Error("DATABASE_BACKUP_ENCRYPTION_KEY_BASE64 must decode to 32 bytes");
  }
  return key;
}

function decodePrivateKey(value: string): string {
  const decoded = Buffer.from(value, "base64").toString("utf8");
  if (!decoded.includes("-----BEGIN PRIVATE KEY-----")) {
    throw new Error(
      "GOOGLE_DRIVE_BACKUP_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64 is not a PEM private key",
    );
  }
  return decoded;
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    const bytes: unknown = chunk;
    if (!Buffer.isBuffer(bytes)) throw new Error("Backup stream returned a non-binary chunk");
    hash.update(bytes);
  }
  return hash.digest("hex");
}

function nonEmpty(value: string | undefined): string | undefined {
  const parsed = value?.trim();
  return parsed === "" ? undefined : parsed;
}
