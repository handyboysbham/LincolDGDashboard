import { GoogleDriveClient } from "@ldg/google-drive";

if (required("APP_ENV") !== "production") {
  throw new Error("Production document storage may be verified only when APP_ENV=production");
}
if (required("LDG_PROCESS") !== "release") {
  throw new Error("Production document storage may be verified only when LDG_PROCESS=release");
}
if (required("OBJECT_STORAGE_VERIFY_CONFIRM") !== "VERIFY_PRIVATE_VERSIONED_DRIVE") {
  throw new Error("OBJECT_STORAGE_VERIFY_CONFIRM must equal VERIFY_PRIVATE_VERSIONED_DRIVE");
}
if (required("DOCUMENT_STORAGE_PROVIDER") !== "google_drive") {
  throw new Error("Production document storage must use google_drive");
}

const sharedDriveId = required("GOOGLE_DRIVE_SHARED_DRIVE_ID");
const folderId = required("GOOGLE_DRIVE_DOCUMENT_FOLDER_ID");
const client = new GoogleDriveClient({
  privateKey: decodePrivateKey(required("GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64")),
  serviceAccountEmail: required("GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL"),
});

await client.assertWritableFolder(folderId, sharedDriveId);
const fileId = await client.generateFileId();
const bytes = new TextEncoder().encode(
  `Lincoln Dirt and Gravel production storage verification ${new Date().toISOString()}\n`,
);
const file = await client.uploadFile({
  appProperties: { purpose: "release-verification" },
  bytes,
  fileId,
  filename: `release-verification-${new Date().toISOString().replaceAll(":", "-")}.txt`,
  mediaType: "text/plain",
  parentFolderId: folderId,
});
const revision = await client.keepLatestRevision(file.id);
const retainedBytes = await client.downloadRevision(file.id, revision.id);
const permissions = await client.listPermissions(file.id);

if (file.trashed || file.driveId !== sharedDriveId || Number(file.size) !== bytes.byteLength) {
  throw new Error(
    "Google Drive did not persist the verification file in the configured Shared Drive",
  );
}
if (!revision.keepForever || !Buffer.from(retainedBytes).equals(Buffer.from(bytes))) {
  throw new Error("Google Drive did not retain the verification revision");
}
if (permissions.some((permission) => permission.type === "anyone")) {
  throw new Error("The Google Drive verification file has a public permission");
}

console.log(
  `Production document storage is private, writable, and revision-retained; verification file ${file.id}; revision ${revision.id}`,
);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function decodePrivateKey(value: string): string {
  const decoded = Buffer.from(value, "base64").toString("utf8");
  if (!decoded.includes("-----BEGIN PRIVATE KEY-----")) {
    throw new Error("GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64 is not a PEM private key");
  }
  return decoded;
}
