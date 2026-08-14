import type { GoogleDriveClient } from "@ldg/google-drive";
import { describe, expect, it, vi } from "vitest";

import type { ServerConfigService } from "../config/server-config.service.js";
import {
  ObjectStorageOperationError,
  ObjectStorageService,
  hasValidSignature,
} from "./object-storage.service.js";

describe("document content signatures", () => {
  it("accepts supported file signatures", () => {
    expect(hasValidSignature("application/pdf", new TextEncoder().encode("%PDF-1.7"))).toBe(true);
    expect(hasValidSignature("image/jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(
      hasValidSignature(
        "image/png",
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe(true);
    expect(hasValidSignature("text/plain", new TextEncoder().encode("supplier ticket"))).toBe(true);
  });

  it("rejects mismatched or unsupported content", () => {
    expect(hasValidSignature("application/pdf", new TextEncoder().encode("not a pdf"))).toBe(false);
    expect(hasValidSignature("text/plain", Uint8Array.from([65, 0, 66]))).toBe(false);
    expect(hasValidSignature("application/zip", Uint8Array.from([80, 75]))).toBe(false);
  });
});

describe("Google Drive document storage", () => {
  it("allocates an immutable file, pins its revision, validates it, and checks the folder", async () => {
    const bytes = new TextEncoder().encode("supplier ticket");
    const assertWritableFolder = vi.fn().mockResolvedValue(undefined);
    const drive = {
      assertWritableFolder,
      downloadRevision: vi.fn().mockResolvedValue(bytes),
      generateFileId: vi.fn().mockResolvedValue("drive-file-id"),
      getFile: vi.fn().mockResolvedValue({
        appProperties: { documentId: "document-id", tenantId: "tenant-id" },
        driveId: "shared-drive-id",
        id: "drive-file-id",
        mimeType: "text/plain",
        name: "ticket.txt",
        size: bytes.byteLength.toString(),
        trashed: false,
      }),
      keepLatestRevision: vi.fn().mockResolvedValue({ id: "revision-1", keepForever: true }),
      uploadFile: vi.fn().mockResolvedValue({
        appProperties: { documentId: "document-id", tenantId: "tenant-id" },
        driveId: "shared-drive-id",
        id: "drive-file-id",
        mimeType: "text/plain",
        name: "ticket.txt",
        size: bytes.byteLength.toString(),
        trashed: false,
      }),
    } as unknown as GoogleDriveClient;
    const storage = driveStorage(drive);

    await expect(storage.allocateLocator("ignored-key")).resolves.toEqual({
      locator: "drive-file-id",
      provider: "google_drive",
    });
    await expect(
      storage.uploadObject({
        bytes,
        documentId: "document-id",
        filename: "ticket.txt",
        mediaType: "text/plain",
        reference: { locator: "drive-file-id", provider: "google_drive" },
        tenantId: "tenant-id",
      }),
    ).resolves.toEqual({ revision: "revision-1" });
    await expect(
      storage.validateObject({
        locator: "drive-file-id",
        provider: "google_drive",
        revision: "revision-1",
      }),
    ).resolves.toMatchObject({ mediaType: "text/plain", signatureValid: true });
    await expect(storage.checkHealth()).resolves.toBeUndefined();

    expect(assertWritableFolder).toHaveBeenCalledWith("documents-folder-id", "shared-drive-id");
  });

  it("rejects a retry that resolves to another document's Drive file", async () => {
    const bytes = new TextEncoder().encode("supplier ticket");
    const drive = {
      uploadFile: vi.fn().mockResolvedValue({
        appProperties: { documentId: "another-document", tenantId: "tenant-id" },
        id: "drive-file-id",
        mimeType: "text/plain",
        name: "ticket.txt",
        size: bytes.byteLength.toString(),
        trashed: false,
      }),
    } as unknown as GoogleDriveClient;

    await expect(
      driveStorage(drive).uploadObject({
        bytes,
        documentId: "document-id",
        filename: "ticket.txt",
        mediaType: "text/plain",
        reference: { locator: "drive-file-id", provider: "google_drive" },
        tenantId: "tenant-id",
      }),
    ).rejects.toBeInstanceOf(ObjectStorageOperationError);
  });
});

function driveStorage(drive: GoogleDriveClient): ObjectStorageService {
  return new ObjectStorageService(undefined, drive, {
    value: {
      objectStorage: {
        googleDrive: {
          apiBaseUrl: "https://www.googleapis.com",
          documentFolderId: "documents-folder-id",
          privateKey: "unused",
          serviceAccountEmail: "storage@example.iam.gserviceaccount.com",
          sharedDriveId: "shared-drive-id",
          tokenUrl: "https://oauth2.googleapis.com/token",
        },
        maxUploadBytes: 20_971_520,
        provider: "google_drive",
      },
    },
  } as ServerConfigService);
}
