import { Inject, Injectable } from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { ServerConfigService } from "../config/server-config.service.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ParsedQuoteToken {
  linkId: string;
  secret: string;
  tenantId: string;
}

@Injectable()
export class QuoteTokenService {
  public constructor(
    @Inject(ServerConfigService) private readonly configuration: ServerConfigService,
  ) {}

  public creationKeyHash(key: string): string {
    return sha256(`quote-send:v1:${key}`);
  }

  public create(input: { linkId: string; quoteVersionId: string; tenantId: string }): {
    hash: string;
    token: string;
  } {
    const secret = createHmac("sha256", this.configuration.value.objectStorage.publicLinkSigningKey)
      .update(`quote-link:v1:${input.tenantId}:${input.linkId}:${input.quoteVersionId}`)
      .digest("base64url");
    return {
      hash: sha256(secret),
      token: `qv1.${input.tenantId}.${input.linkId}.${secret}`,
    };
  }

  public matches(secret: string, expectedHash: string): boolean {
    const actual = Buffer.from(sha256(secret), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  public parse(token: string): ParsedQuoteToken | undefined {
    const [version, tenantId, linkId, secret, extra] = token.split(".");
    if (
      version !== "qv1" ||
      tenantId === undefined ||
      !uuidPattern.test(tenantId) ||
      linkId === undefined ||
      !uuidPattern.test(linkId) ||
      secret === undefined ||
      secret.length < 32 ||
      extra !== undefined
    ) {
      return undefined;
    }
    return { linkId, secret, tenantId };
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
