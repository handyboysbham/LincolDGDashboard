import { Inject, Injectable } from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { ServerConfigService } from "../config/server-config.service.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CustomerCapabilityKind = "contract" | "document" | "invoice" | "project" | "quote";

export interface CustomerCapabilityReference {
  kind: CustomerCapabilityKind;
  linkId: string;
  targetId: string;
  tenantId: string;
}

export interface ParsedProjectCapability {
  linkId: string;
  secret: string;
  tenantId: string;
}

const capabilityDefinitions: Record<
  CustomerCapabilityKind,
  { hmacLabel: string; path: string; tokenVersion: string }
> = {
  contract: { hmacLabel: "contract-link:v1", path: "contracts", tokenVersion: "cv1" },
  document: { hmacLabel: "document-link:v1", path: "documents", tokenVersion: "v1" },
  invoice: { hmacLabel: "invoice-link:v1", path: "invoices", tokenVersion: "iv1" },
  project: { hmacLabel: "project-link:v1", path: "projects", tokenVersion: "pv1" },
  quote: { hmacLabel: "quote-link:v1", path: "quotes", tokenVersion: "qv1" },
};

@Injectable()
export class CustomerCapabilityTokenService {
  public constructor(
    @Inject(ServerConfigService) private readonly configuration: ServerConfigService,
  ) {}

  public defaultExpiresInSeconds(): number {
    return this.configuration.value.objectStorage.publicLinkDefaultExpiresSeconds;
  }

  public create(reference: CustomerCapabilityReference): { hash: string; token: string } {
    const definition = capabilityDefinitions[reference.kind];
    const secret = createHmac("sha256", this.configuration.value.objectStorage.publicLinkSigningKey)
      .update(
        `${definition.hmacLabel}:${reference.tenantId}:${reference.linkId}:${reference.targetId}`,
      )
      .digest("base64url");
    return {
      hash: sha256(secret),
      token: `${definition.tokenVersion}.${reference.tenantId}.${reference.linkId}.${secret}`,
    };
  }

  public customerPath(reference: CustomerCapabilityReference): string {
    const definition = capabilityDefinitions[reference.kind];
    return `/customer/${definition.path}/${this.create(reference).token}`;
  }

  public customerUrl(reference: CustomerCapabilityReference): string {
    return `${this.configuration.value.web.origin.replace(/\/$/, "")}${this.customerPath(reference)}`;
  }

  public matches(secret: string, expectedHash: string): boolean {
    const actual = Buffer.from(sha256(secret), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  public parseProject(token: string): ParsedProjectCapability | undefined {
    const [version, tenantId, linkId, secret, extra] = token.split(".");
    if (
      version !== capabilityDefinitions.project.tokenVersion ||
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
