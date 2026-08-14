import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type GetObjectCommandOutput,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GoogleDriveApiError, type GoogleDriveClient } from "@ldg/google-drive";
import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

import { ServerConfigService } from "../config/server-config.service.js";
import {
  GOOGLE_DRIVE_CLIENT,
  OBJECT_STORAGE_CLIENT,
  type DocumentStorageProvider,
} from "./object-storage.tokens.js";

export interface StoredObjectValidation {
  mediaType: string;
  sha256: string;
  sizeBytes: number;
  signatureValid: boolean;
}

export interface StoredObjectReference {
  locator: string;
  provider: DocumentStorageProvider;
  revision?: string;
}

export class StoredObjectNotFoundError extends Error {
  public constructor() {
    super("Stored object was not found");
    this.name = "StoredObjectNotFoundError";
  }
}

export class ObjectStorageOperationError extends Error {
  public constructor() {
    super("Object storage operation failed");
    this.name = "ObjectStorageOperationError";
  }
}

export class StoredObjectTooLargeError extends Error {
  public constructor() {
    super("Stored object exceeds the configured upload limit");
    this.name = "StoredObjectTooLargeError";
  }
}

@Injectable()
export class ObjectStorageService {
  public constructor(
    @Inject(OBJECT_STORAGE_CLIENT) private readonly s3Client: S3Client | undefined,
    @Inject(GOOGLE_DRIVE_CLIENT) private readonly driveClient: GoogleDriveClient | undefined,
    @Inject(ServerConfigService) private readonly configuration: ServerConfigService,
  ) {}

  public provider(): DocumentStorageProvider {
    return this.configuration.value.objectStorage.provider;
  }

  public async allocateLocator(objectKey: string): Promise<StoredObjectReference> {
    if (this.provider() === "s3") return { locator: objectKey, provider: "s3" };
    try {
      return {
        locator: await this.requiredDriveClient().generateFileId(),
        provider: "google_drive",
      };
    } catch {
      throw new ObjectStorageOperationError();
    }
  }

  public async createUploadUrl(input: {
    mediaType: string;
    reference: StoredObjectReference;
  }): Promise<{ expiresAt: Date; headers: Record<string, string>; url: string }> {
    this.assertProvider(input.reference.provider, "s3");
    const storage = this.requiredS3Configuration();
    const expiresIn = this.configuration.value.objectStorage.presignExpiresSeconds;
    const url = await getSignedUrl(
      this.requiredS3Client(),
      new PutObjectCommand({
        Bucket: storage.bucket,
        ContentType: input.mediaType,
        Key: input.reference.locator,
      }),
      { expiresIn },
    );
    return {
      expiresAt: new Date(Date.now() + expiresIn * 1_000),
      headers: { "content-type": input.mediaType },
      url,
    };
  }

  public async createDownloadUrl(input: {
    filename: string;
    mediaType: string;
    reference: StoredObjectReference;
  }): Promise<{ expiresAt: Date; url: string }> {
    this.assertProvider(input.reference.provider, "s3");
    const storage = this.requiredS3Configuration();
    const expiresIn = this.configuration.value.objectStorage.presignExpiresSeconds;
    const url = await getSignedUrl(
      this.requiredS3Client(),
      new GetObjectCommand({
        Bucket: storage.bucket,
        Key: input.reference.locator,
        ResponseContentDisposition: contentDisposition(input.filename),
        ResponseContentType: input.mediaType,
      }),
      { expiresIn },
    );
    return { expiresAt: new Date(Date.now() + expiresIn * 1_000), url };
  }

  public async uploadObject(input: {
    bytes: Uint8Array;
    documentId: string;
    filename: string;
    mediaType: string;
    reference: StoredObjectReference;
    tenantId: string;
  }): Promise<{ revision: string }> {
    this.assertProvider(input.reference.provider, "google_drive");
    const drive = this.requiredDriveConfiguration();
    try {
      const file = await this.requiredDriveClient().uploadFile({
        appProperties: {
          documentId: input.documentId,
          tenantId: input.tenantId,
        },
        bytes: input.bytes,
        fileId: input.reference.locator,
        filename: input.filename,
        mediaType: input.mediaType,
        parentFolderId: drive.documentFolderId,
      });
      if (
        file.id !== input.reference.locator ||
        file.trashed ||
        file.mimeType !== input.mediaType ||
        Number(file.size) !== input.bytes.byteLength ||
        file.appProperties?.documentId !== input.documentId ||
        file.appProperties.tenantId !== input.tenantId
      ) {
        throw new ObjectStorageOperationError();
      }
      const revision = await this.requiredDriveClient().keepLatestRevision(file.id);
      if (!revision.keepForever) throw new ObjectStorageOperationError();
      return { revision: revision.id };
    } catch (error) {
      if (error instanceof ObjectStorageOperationError) throw error;
      throw new ObjectStorageOperationError();
    }
  }

  public async validateObject(reference: StoredObjectReference): Promise<StoredObjectValidation> {
    if (reference.provider === "s3") return this.validateS3Object(reference.locator);
    this.assertProvider(reference.provider, "google_drive");
    try {
      const drive = this.requiredDriveClient();
      if (!reference.revision) throw new ObjectStorageOperationError();
      const metadata = await drive.getFile(reference.locator);
      const size = Number(metadata.size);
      if (Number.isFinite(size) && size > this.configuration.value.objectStorage.maxUploadBytes) {
        throw new StoredObjectTooLargeError();
      }
      const bytes = await drive.downloadRevision(reference.locator, reference.revision);
      return validation(metadata.mimeType, bytes);
    } catch (error) {
      if (error instanceof StoredObjectTooLargeError) throw error;
      if (error instanceof GoogleDriveApiError && error.status === 404) {
        throw new StoredObjectNotFoundError();
      }
      throw new ObjectStorageOperationError();
    }
  }

  public async downloadObject(reference: StoredObjectReference): Promise<Uint8Array> {
    this.assertProvider(reference.provider, "google_drive");
    try {
      if (!reference.revision) throw new ObjectStorageOperationError();
      return await this.requiredDriveClient().downloadRevision(
        reference.locator,
        reference.revision,
      );
    } catch (error) {
      if (error instanceof GoogleDriveApiError && error.status === 404) {
        throw new StoredObjectNotFoundError();
      }
      throw new ObjectStorageOperationError();
    }
  }

  public async checkHealth(): Promise<void> {
    try {
      if (this.provider() === "s3") {
        await this.requiredS3Client().send(
          new HeadBucketCommand({ Bucket: this.requiredS3Configuration().bucket }),
        );
        return;
      }
      const drive = this.requiredDriveConfiguration();
      await this.requiredDriveClient().assertWritableFolder(
        drive.documentFolderId,
        drive.sharedDriveId,
      );
    } catch {
      throw new ObjectStorageOperationError();
    }
  }

  public async deleteObject(reference: StoredObjectReference): Promise<void> {
    this.assertProvider(reference.provider, "s3");
    await this.requiredS3Client().send(
      new DeleteObjectCommand({
        Bucket: this.requiredS3Configuration().bucket,
        Key: reference.locator,
      }),
    );
  }

  private async validateS3Object(locator: string): Promise<StoredObjectValidation> {
    this.assertProvider("s3", "s3");
    const storage = this.requiredS3Configuration();
    let response: GetObjectCommandOutput;
    try {
      const head = await this.requiredS3Client().send(
        new HeadObjectCommand({ Bucket: storage.bucket, Key: locator }),
      );
      if (
        head.ContentLength !== undefined &&
        head.ContentLength > this.configuration.value.objectStorage.maxUploadBytes
      ) {
        throw new StoredObjectTooLargeError();
      }
      response = await this.requiredS3Client().send(
        new GetObjectCommand({ Bucket: storage.bucket, Key: locator }),
      );
    } catch (error) {
      if (error instanceof StoredObjectTooLargeError) throw error;
      if (httpStatus(error) === 404) throw new StoredObjectNotFoundError();
      throw new ObjectStorageOperationError();
    }
    if (!response.Body) throw new ObjectStorageOperationError();
    return validation(response.ContentType, await response.Body.transformToByteArray());
  }

  private assertProvider(actual: DocumentStorageProvider, expected: DocumentStorageProvider): void {
    if (actual !== expected || this.provider() !== expected) {
      throw new ObjectStorageOperationError();
    }
  }

  private requiredS3Client(): S3Client {
    if (!this.s3Client) throw new ObjectStorageOperationError();
    return this.s3Client;
  }

  private requiredDriveClient(): GoogleDriveClient {
    if (!this.driveClient) throw new ObjectStorageOperationError();
    return this.driveClient;
  }

  private requiredS3Configuration(): NonNullable<
    ServerConfigService["value"]["objectStorage"]["s3"]
  > {
    const configuration = this.configuration.value.objectStorage.s3;
    if (!configuration) throw new ObjectStorageOperationError();
    return configuration;
  }

  private requiredDriveConfiguration(): NonNullable<
    ServerConfigService["value"]["objectStorage"]["googleDrive"]
  > {
    const configuration = this.configuration.value.objectStorage.googleDrive;
    if (!configuration) throw new ObjectStorageOperationError();
    return configuration;
  }
}

function validation(mediaTypeValue: string | undefined, bytes: Uint8Array): StoredObjectValidation {
  const mediaType = normalizeMediaType(mediaTypeValue);
  return {
    mediaType,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    signatureValid: hasValidSignature(mediaType, bytes),
    sizeBytes: bytes.byteLength,
  };
}

function httpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const metadata = "$metadata" in error ? error.$metadata : undefined;
  if (!metadata || typeof metadata !== "object" || !("httpStatusCode" in metadata)) {
    return undefined;
  }
  return typeof metadata.httpStatusCode === "number" ? metadata.httpStatusCode : undefined;
}

function normalizeMediaType(value: string | undefined): string {
  return (value ?? "application/octet-stream").split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function hasValidSignature(mediaType: string, bytes: Uint8Array): boolean {
  if (mediaType === "application/pdf") {
    return bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
  }
  if (mediaType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mediaType === "image/png") {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return png.every((value, index) => bytes[index] === value);
  }
  if (mediaType === "text/plain") return !bytes.includes(0);
  return false;
}

function contentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename).replaceAll("'", "%27");
  return `attachment; filename*=UTF-8''${encoded}`;
}
