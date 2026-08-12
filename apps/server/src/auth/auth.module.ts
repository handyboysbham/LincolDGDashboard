import { Module } from "@nestjs/common";

import { AuthenticationGuard } from "./authentication.guard.js";
import { AuthenticatedActorService } from "./authenticated-actor.service.js";
import { JwtVerifierService } from "./jwt-verifier.service.js";
import { PermissionsGuard } from "./permissions.guard.js";

@Module({
  exports: [AuthenticationGuard, PermissionsGuard],
  providers: [AuthenticatedActorService, AuthenticationGuard, JwtVerifierService, PermissionsGuard],
})
export class AuthModule {}
