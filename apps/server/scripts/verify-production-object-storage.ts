import {
  DeleteObjectCommand,
  GetBucketVersioningCommand,
  HeadBucketCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

if (required("APP_ENV") !== "production") {
  throw new Error("Production object storage may be verified only when APP_ENV=production");
}
if (required("LDG_PROCESS") !== "release") {
  throw new Error("Production object storage may be verified only when LDG_PROCESS=release");
}
if (required("OBJECT_STORAGE_VERIFY_CONFIRM") !== "VERIFY_PRIVATE_VERSIONED_BUCKET") {
  throw new Error("OBJECT_STORAGE_VERIFY_CONFIRM must equal VERIFY_PRIVATE_VERSIONED_BUCKET");
}

const bucket = required("MINIO_BUCKET");
const client = new S3Client({
  credentials: {
    accessKeyId: required("MINIO_APP_USER"),
    secretAccessKey: required("MINIO_APP_PASSWORD"),
  },
  endpoint: requiredHttpsUrl("MINIO_ENDPOINT"),
  forcePathStyle: requiredBoolean("MINIO_FORCE_PATH_STYLE"),
  region: required("MINIO_REGION"),
});
const verificationKey = `release-verification/${randomUUID()}.txt`;
const createdVersionIds: string[] = [];
let verificationFailure: unknown;

try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  const versioning = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
  if (versioning.Status !== "Enabled") {
    throw new Error("The production object-storage bucket does not have versioning enabled");
  }

  for (const content of [
    "lincoln-dg-storage-verification-v1",
    "lincoln-dg-storage-verification-v2",
  ]) {
    const stored = await client.send(
      new PutObjectCommand({
        Body: content,
        Bucket: bucket,
        ContentType: "text/plain",
        Key: verificationKey,
      }),
    );
    if (!stored.VersionId) {
      throw new Error("The storage provider did not return an object VersionId");
    }
    createdVersionIds.push(stored.VersionId);
  }
  if (new Set(createdVersionIds).size !== 2) {
    throw new Error("The storage provider did not create two distinct object versions");
  }

  const listed = await client.send(
    new ListObjectVersionsCommand({ Bucket: bucket, Prefix: verificationKey }),
  );
  const listedVersionIds = new Set(
    listed.Versions?.filter((version) => version.Key === verificationKey)
      .map((version) => version.VersionId)
      .filter((versionId): versionId is string => Boolean(versionId)),
  );
  if (!createdVersionIds.every((versionId) => listedVersionIds.has(versionId))) {
    throw new Error("The production object-storage bucket did not retain both test versions");
  }

  console.log(
    `Production object storage is reachable and versioned; bucket ${bucket}; retained test versions 2`,
  );
} catch (error) {
  verificationFailure = error;
}

const cleanupResults = await Promise.allSettled(
  createdVersionIds.map((versionId) =>
    client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: verificationKey, VersionId: versionId }),
    ),
  ),
);
client.destroy();

if (verificationFailure) {
  if (verificationFailure instanceof Error) throw verificationFailure;
  throw new Error("Object-storage verification failed with a non-Error value");
}
if (cleanupResults.some((result) => result.status === "rejected")) {
  throw new Error("Object-storage verification passed, but cleanup of a test version failed");
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredHttpsUrl(name: string): string {
  const value = required(name);
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS`);
  if (url.username || url.password) throw new Error(`${name} must not contain credentials`);
  return url.toString();
}

function requiredBoolean(name: string): boolean {
  const value = required(name);
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be either true or false`);
}
