import { Inject, Injectable } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";

import { ServerConfigService } from "../config/server-config.service.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type TransferPurpose = "download" | "upload";

export interface ParsedDocumentTransferToken {
  documentId: string;
  expiresAt: Date;
  purpose: TransferPurpose;
  tenantId: string;
}

@Injectable()
export class DocumentTransferTokenService {
  public constructor(
    @Inject(ServerConfigService) private readonly configuration: ServerConfigService,
  ) {}

  public create(input: {
    documentId: string;
    expiresAt: Date;
    purpose: TransferPurpose;
    tenantId: string;
  }): string {
    const expiresAt = Math.floor(input.expiresAt.getTime() / 1_000);
    const payload = `v1.${input.tenantId}.${input.documentId}.${input.purpose}.${expiresAt.toString()}`;
    return `${payload}.${this.signature(payload)}`;
  }

  public parse(token: string, purpose: TransferPurpose): ParsedDocumentTransferToken | undefined {
    const [version, tenantId, documentId, tokenPurpose, expiresAtValue, signature, extra] =
      token.split(".");
    if (
      version !== "v1" ||
      tenantId === undefined ||
      !uuidPattern.test(tenantId) ||
      documentId === undefined ||
      !uuidPattern.test(documentId) ||
      tokenPurpose !== purpose ||
      expiresAtValue === undefined ||
      signature === undefined ||
      extra !== undefined
    ) {
      return undefined;
    }
    const expiresAtSeconds = Number(expiresAtValue);
    if (!Number.isSafeInteger(expiresAtSeconds)) return undefined;
    const expiresAt = new Date(expiresAtSeconds * 1_000);
    if (expiresAt <= new Date()) return undefined;
    const payload = `v1.${tenantId}.${documentId}.${tokenPurpose}.${expiresAtValue}`;
    const expected = Buffer.from(this.signature(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined;
    return { documentId, expiresAt, purpose, tenantId };
  }

  private signature(payload: string): string {
    return createHmac("sha256", this.configuration.value.objectStorage.publicLinkSigningKey)
      .update(`document-transfer:${payload}`)
      .digest("base64url");
  }
}
