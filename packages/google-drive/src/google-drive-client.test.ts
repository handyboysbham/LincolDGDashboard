import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { GoogleDriveApiError, GoogleDriveClient } from "./google-drive-client.js";

const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
  format: "pem",
  type: "pkcs8",
});

describe("GoogleDriveClient", () => {
  it("uses a cached service-account token and allocates file IDs", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: "access-token", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ ids: ["drive-file-1"] }))
      .mockResolvedValueOnce(json({ ids: ["drive-file-2"] }));
    const client = configuredClient(fetchImplementation);

    await expect(client.generateFileId()).resolves.toBe("drive-file-1");
    await expect(client.generateFileId()).resolves.toBe("drive-file-2");

    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(requestedUrl(fetchImplementation.mock.calls[0]?.[0])).toBe("https://oauth.test/token");
    expect(requestedUrl(fetchImplementation.mock.calls[1]?.[0])).toContain(
      "/drive/v3/files/generateIds",
    );
    expect(new Headers(fetchImplementation.mock.calls[1]?.[1]?.headers).get("authorization")).toBe(
      "Bearer access-token",
    );
  });

  it("uploads through a resumable session and retains the latest revision", async () => {
    const file = {
      appProperties: { documentId: "document-1", tenantId: "tenant-1" },
      driveId: "shared-drive",
      id: "drive-file",
      mimeType: "text/plain",
      name: "ticket.txt",
      size: "6",
      trashed: false,
    };
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: "access-token", expires_in: 3600 }))
      .mockResolvedValueOnce(
        new Response(undefined, {
          headers: { location: "https://upload.test/session" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(json(file))
      .mockResolvedValueOnce(
        json({ revisions: [{ id: "revision-1", keepForever: false, size: "6" }] }),
      )
      .mockResolvedValueOnce(json({ id: "revision-1", keepForever: true, size: "6" }))
      .mockResolvedValueOnce(new Response("ticket"));
    const client = configuredClient(fetchImplementation);

    await expect(
      client.uploadFile({
        appProperties: file.appProperties,
        bytes: new TextEncoder().encode("ticket"),
        fileId: file.id,
        filename: file.name,
        mediaType: file.mimeType,
        parentFolderId: "documents-folder",
      }),
    ).resolves.toMatchObject(file);
    await expect(client.keepLatestRevision(file.id)).resolves.toMatchObject({
      id: "revision-1",
      keepForever: true,
    });
    await expect(client.downloadRevision(file.id, "revision-1")).resolves.toEqual(
      new TextEncoder().encode("ticket"),
    );

    expect(fetchImplementation.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(requestedUrl(fetchImplementation.mock.calls[2]?.[0])).toBe(
      "https://upload.test/session",
    );
    expect(fetchImplementation.mock.calls[2]?.[1]?.method).toBe("PUT");
    expect(fetchImplementation.mock.calls[4]?.[1]?.method).toBe("PATCH");
    expect(requestedUrl(fetchImplementation.mock.calls[5]?.[0])).toContain(
      "/revisions/revision-1?alt=media",
    );
  });

  it("rejects a folder outside the configured Shared Drive", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: "access-token", expires_in: 3600 }))
      .mockResolvedValueOnce(
        json({
          capabilities: { canAddChildren: true },
          driveId: "another-drive",
          id: "folder",
          mimeType: "application/vnd.google-apps.folder",
          name: "Documents",
          trashed: false,
        }),
      );

    await expect(
      configuredClient(fetchImplementation).assertWritableFolder("folder", "shared-drive"),
    ).rejects.toBeInstanceOf(GoogleDriveApiError);
  });
});

function configuredClient(fetchImplementation: typeof fetch): GoogleDriveClient {
  return new GoogleDriveClient({
    apiBaseUrl: "https://drive.test",
    fetchImplementation,
    privateKey,
    serviceAccountEmail: "storage@example.iam.gserviceaccount.com",
    tokenUrl: "https://oauth.test/token",
  });
}

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), {
    ...init,
    headers,
    status: init.status ?? 200,
  });
}

function requestedUrl(value: RequestInfo | URL | undefined): string {
  if (typeof value === "string") return value;
  if (value instanceof URL) return value.toString();
  return value?.url ?? "";
}
