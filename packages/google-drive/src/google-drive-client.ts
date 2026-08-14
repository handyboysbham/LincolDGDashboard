import { createSign } from "node:crypto";

const driveScope = "https://www.googleapis.com/auth/drive";

export interface GoogleDriveClientConfiguration {
  apiBaseUrl?: string;
  fetchImplementation?: typeof fetch;
  privateKey: string;
  serviceAccountEmail: string;
  timeoutMs?: number;
  tokenUrl?: string;
}

export interface GoogleDriveFile {
  appProperties?: Record<string, string>;
  capabilities?: { canAddChildren?: boolean };
  driveId?: string;
  id: string;
  md5Checksum?: string;
  mimeType: string;
  name: string;
  sha256Checksum?: string;
  size?: string;
  trashed: boolean;
}

export interface GoogleDriveRevision {
  id: string;
  keepForever: boolean;
  modifiedTime?: string;
  size?: string;
}

export interface GoogleDrivePermission {
  allowFileDiscovery?: boolean;
  id: string;
  role: string;
  type: string;
}

export class GoogleDriveApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GoogleDriveApiError";
  }
}

export class GoogleDriveClient {
  private readonly apiBaseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;
  private readonly tokenUrl: string;
  private accessToken?: { expiresAt: number; value: string };

  public constructor(private readonly configuration: GoogleDriveClientConfiguration) {
    this.apiBaseUrl = (configuration.apiBaseUrl ?? "https://www.googleapis.com").replace(/\/$/, "");
    this.fetchImplementation = configuration.fetchImplementation ?? fetch;
    this.timeoutMs = configuration.timeoutMs ?? 30_000;
    this.tokenUrl = configuration.tokenUrl ?? "https://oauth2.googleapis.com/token";
  }

  public async generateFileId(): Promise<string> {
    const response = await this.authorizedFetch(
      `${this.apiBaseUrl}/drive/v3/files/generateIds?count=1&space=drive&type=files`,
    );
    const body = await readJson<{ ids?: string[] }>(response);
    const id = body.ids?.[0];
    if (!id) throw new GoogleDriveApiError("Google Drive did not allocate a file ID", 502);
    return id;
  }

  public async getFile(fileId: string): Promise<GoogleDriveFile> {
    const fields = [
      "id",
      "name",
      "mimeType",
      "size",
      "md5Checksum",
      "sha256Checksum",
      "trashed",
      "driveId",
      "appProperties",
      "capabilities(canAddChildren)",
    ].join(",");
    const response = await this.authorizedFetch(
      `${this.apiBaseUrl}/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${encodeURIComponent(fields)}`,
    );
    return readJson<GoogleDriveFile>(response);
  }

  public async assertWritableFolder(folderId: string, sharedDriveId: string): Promise<void> {
    const folder = await this.getFile(folderId);
    if (
      folder.trashed ||
      folder.mimeType !== "application/vnd.google-apps.folder" ||
      folder.driveId !== sharedDriveId ||
      folder.capabilities?.canAddChildren !== true
    ) {
      throw new GoogleDriveApiError(
        "Configured Google Drive folder is unavailable or not writable",
        503,
      );
    }
  }

  public async uploadFile(input: {
    appProperties?: Record<string, string>;
    bytes: Uint8Array;
    fileId: string;
    filename: string;
    mediaType: string;
    parentFolderId: string;
  }): Promise<GoogleDriveFile> {
    return this.uploadContent({
      ...input,
      body: Buffer.from(input.bytes),
      sizeBytes: input.bytes.byteLength,
    });
  }

  public async uploadBlob(input: {
    appProperties?: Record<string, string>;
    blob: Blob;
    fileId: string;
    filename: string;
    mediaType: string;
    parentFolderId: string;
  }): Promise<GoogleDriveFile> {
    return this.uploadContent({
      ...input,
      body: input.blob,
      sizeBytes: input.blob.size,
    });
  }

  private async uploadContent(input: {
    appProperties?: Record<string, string>;
    body: BodyInit;
    fileId: string;
    filename: string;
    mediaType: string;
    parentFolderId: string;
    sizeBytes: number;
  }): Promise<GoogleDriveFile> {
    const metadata = {
      appProperties: input.appProperties,
      id: input.fileId,
      mimeType: input.mediaType,
      name: input.filename,
      parents: [input.parentFolderId],
    };
    const fields = "id,name,mimeType,size,md5Checksum,sha256Checksum,trashed,driveId,appProperties";
    const session = await this.authorizedFetch(
      `${this.apiBaseUrl}/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=${encodeURIComponent(fields)}`,
      {
        body: JSON.stringify(metadata),
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-length": input.sizeBytes.toString(),
          "x-upload-content-type": input.mediaType,
        },
        method: "POST",
      },
      [409],
    );
    if (session.status === 409) return this.getFile(input.fileId);
    const uploadUrl = session.headers.get("location");
    if (!uploadUrl) {
      throw new GoogleDriveApiError("Google Drive did not return a resumable upload URL", 502);
    }
    const uploaded = await this.authorizedFetch(uploadUrl, {
      body: input.body,
      headers: {
        "content-length": input.sizeBytes.toString(),
        "content-type": input.mediaType,
      },
      method: "PUT",
    });
    return readJson<GoogleDriveFile>(uploaded);
  }

  public async keepLatestRevision(fileId: string): Promise<GoogleDriveRevision> {
    const response = await this.authorizedFetch(
      `${this.apiBaseUrl}/drive/v3/files/${encodeURIComponent(fileId)}/revisions?pageSize=200&fields=${encodeURIComponent("revisions(id,keepForever,modifiedTime,size)")}`,
    );
    const body = await readJson<{ revisions?: GoogleDriveRevision[] }>(response);
    const revision = body.revisions?.at(-1);
    if (!revision) throw new GoogleDriveApiError("Google Drive file has no revision", 502);
    if (revision.keepForever) return revision;
    const kept = await this.authorizedFetch(
      `${this.apiBaseUrl}/drive/v3/files/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revision.id)}?fields=id,keepForever,modifiedTime,size`,
      {
        body: JSON.stringify({ keepForever: true }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );
    return readJson<GoogleDriveRevision>(kept);
  }

  public async listPermissions(fileId: string): Promise<GoogleDrivePermission[]> {
    const response = await this.authorizedFetch(
      `${this.apiBaseUrl}/drive/v3/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true&fields=${encodeURIComponent("permissions(id,type,role,allowFileDiscovery)")}`,
    );
    const body = await readJson<{ permissions?: GoogleDrivePermission[] }>(response);
    return body.permissions ?? [];
  }

  public async downloadFile(fileId: string): Promise<Uint8Array> {
    const response = await this.authorizedFetch(
      `${this.apiBaseUrl}/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  public async downloadRevision(fileId: string, revisionId: string): Promise<Uint8Array> {
    const response = await this.authorizedFetch(
      `${this.apiBaseUrl}/drive/v3/files/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revisionId)}?alt=media`,
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  private async authorizedFetch(
    url: string,
    init: RequestInit = {},
    allowedStatuses: number[] = [],
  ): Promise<Response> {
    const token = await this.token();
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        ...init,
        headers: { ...headersToRecord(init.headers), authorization: `Bearer ${token}` },
        signal: init.signal ?? AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new GoogleDriveApiError("Google Drive request failed", 503);
    }
    if (!response.ok && !allowedStatuses.includes(response.status)) {
      throw new GoogleDriveApiError(
        `Google Drive request failed with status ${response.status.toString()}`,
        response.status,
      );
    }
    return response;
  }

  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) {
      return this.accessToken.value;
    }
    const now = Math.floor(Date.now() / 1_000);
    const assertion = signJwt(
      {
        alg: "RS256",
        typ: "JWT",
      },
      {
        aud: this.tokenUrl,
        exp: now + 3_600,
        iat: now,
        iss: this.configuration.serviceAccountEmail,
        scope: driveScope,
      },
      this.configuration.privateKey,
    );
    let response: Response;
    try {
      response = await this.fetchImplementation(this.tokenUrl, {
        body: new URLSearchParams({
          assertion,
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new GoogleDriveApiError("Google OAuth token request failed", 503);
    }
    if (!response.ok) {
      throw new GoogleDriveApiError(
        `Google OAuth token request failed with status ${response.status.toString()}`,
        response.status,
      );
    }
    const body = await readJson<{ access_token?: string; expires_in?: number }>(response);
    if (!body.access_token) throw new GoogleDriveApiError("Google OAuth token is missing", 502);
    this.accessToken = {
      expiresAt: Date.now() + (body.expires_in ?? 3_600) * 1_000,
      value: body.access_token,
    };
    return body.access_token;
  }
}

function signJwt(header: object, payload: object, privateKey: string): string {
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${signer.sign(privateKey, "base64url")}`;
}

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(new Headers(headers).entries());
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new GoogleDriveApiError("Google Drive returned an invalid JSON response", 502);
  }
}
