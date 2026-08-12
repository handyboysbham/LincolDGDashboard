import { Inject, Injectable } from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import { ServerConfigService } from "../config/server-config.service.js";

export interface VerifiedIdentity {
  externalSubject: string;
  tenantId: string;
}

@Injectable()
export class JwtVerifierService {
  private readonly verification:
    { audience: string; issuer: string; keySet: ReturnType<typeof createRemoteJWKSet> } | undefined;

  public constructor(@Inject(ServerConfigService) configuration: ServerConfigService) {
    const auth = configuration.value.auth;
    if (auth.mode === "jwt") {
      this.verification = {
        audience: auth.audience,
        issuer: auth.issuer,
        keySet: createRemoteJWKSet(new URL(auth.jwksUrl)),
      };
    }
  }

  public async verify(token: string): Promise<VerifiedIdentity> {
    if (!this.verification) throw new Error("JWT verification is not configured");
    const { payload } = await jwtVerify(token, this.verification.keySet, {
      audience: this.verification.audience,
      issuer: this.verification.issuer,
      requiredClaims: ["sub", "app_metadata"],
    });
    return identityFromPayload(payload);
  }
}

export function identityFromPayload(payload: JWTPayload): VerifiedIdentity {
  if (!payload.sub || payload.sub.length > 255) {
    throw new Error("JWT subject is missing or invalid");
  }
  const metadata = payload.app_metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("JWT app_metadata is missing");
  }
  const tenantId = (metadata as Record<string, unknown>).tenant_id;
  if (typeof tenantId !== "string") {
    throw new Error("JWT tenant claim is missing");
  }
  return { externalSubject: payload.sub, tenantId };
}
