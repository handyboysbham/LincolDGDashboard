import { Module } from "@nestjs/common";

import { DevelopmentAuthGuard } from "./development-auth.guard.js";
import { PermissionsGuard } from "./permissions.guard.js";

@Module({
  exports: [DevelopmentAuthGuard, PermissionsGuard],
  providers: [DevelopmentAuthGuard, PermissionsGuard],
})
export class AuthModule {}
