import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type GetObjectCommandOutput,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

import { ServerConfigService } from "../config/server-config.service.js";
import { OBJECT_STORAGE_CLIENT } from "./object-storage.tokens.js";

export interface StoredObjectValidation {
  mediaType: string;
  sha256: string;
  sizeBytes: number;
  signatureValid: boolean;
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
    @Inject(OBJECT_STORAGE_CLIENT) private readonly client: S3Client,
    @Inject(ServerConfigService) private readonly configuration: ServerConfigService,
  ) {}

  public async createUploadUrl(input: {
    mediaType: string;
    objectKey: string;
  }): Promise<{ expiresAt: Date; headers: Record<string, string>; url: string }> {
    const expiresIn = this.configuration.value.objectStorage.presignExpiresSeconds;
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.configuration.value.objectStorage.bucket,
        ContentType: input.mediaType,
        Key: input.objectKey,
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
    objectKey: string;
  }): Promise<{ expiresAt: Date; url: string }> {
    const expiresIn = this.configuration.value.objectStorage.presignExpiresSeconds;
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.configuration.value.objectStorage.bucket,
        Key: input.objectKey,
        ResponseContentDisposition: contentDisposition(input.filename),
        ResponseContentType: input.mediaType,
      }),
      { expiresIn },
    );
    return { expiresAt: new Date(Date.now() + expiresIn * 1_000), url };
  }

  public async validateObject(objectKey: string): Promise<StoredObjectValidation> {
    let response: GetObjectCommandOutput;
    try {
      const head = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.configuration.value.objectStorage.bucket,
          Key: objectKey,
        }),
      );
      if (
        head.ContentLength !== undefined &&
        head.ContentLength > this.configuration.value.objectStorage.maxUploadBytes
      ) {
        throw new StoredObjectTooLargeError();
      }
      response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.configuration.value.objectStorage.bucket,
          Key: objectKey,
        }),
      );
    } catch (error) {
      if (error instanceof StoredObjectTooLargeError) throw error;
      if (httpStatus(error) === 404) throw new StoredObjectNotFoundError();
      throw new ObjectStorageOperationError();
    }
    if (!response.Body) {
      throw new Error("Stored object has no body");
    }
    const bytes = await response.Body.transformToByteArray();
    const mediaType = normalizeMediaType(response.ContentType);
    return {
      mediaType,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      signatureValid: hasValidSignature(mediaType, bytes),
      sizeBytes: bytes.byteLength,
    };
  }

  public async deleteObject(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.configuration.value.objectStorage.bucket,
        Key: objectKey,
      }),
    );
  }
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
  if (mediaType === "text/plain") {
    return !bytes.includes(0);
  }
  return false;
}

function contentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename).replaceAll("'", "%27");
  return `attachment; filename*=UTF-8''${encoded}`;
}
