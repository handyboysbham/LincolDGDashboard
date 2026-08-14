import { decryptBackupFile } from "./backup-crypto.js";

const encryptedPath = process.argv[2];
const destinationPath = process.argv[3];
if (!encryptedPath || !destinationPath) {
  throw new Error("Usage: backup-decrypt <backup.ldgenc> <restored.tar.gz>");
}
const encodedKey = process.env.DATABASE_BACKUP_ENCRYPTION_KEY_BASE64?.trim();
if (!encodedKey) throw new Error("DATABASE_BACKUP_ENCRYPTION_KEY_BASE64 is required");
const key = Buffer.from(encodedKey, "base64");
if (key.byteLength !== 32) {
  throw new Error("DATABASE_BACKUP_ENCRYPTION_KEY_BASE64 must decode to 32 bytes");
}

await decryptBackupFile({ destinationPath, encryptedPath, key });
console.log(`Backup decrypted to ${destinationPath}`);
