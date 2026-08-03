import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";

import { AuthModule } from "./auth/auth.module.js";
import { DevelopmentAuthGuard } from "./auth/development-auth.guard.js";
import { PermissionsGuard } from "./auth/permissions.guard.js";
import { CommercialModule } from "./commercial/commercial.module.js";
import { ConfigurationModule } from "./config/configuration.module.js";
import { ContextModule } from "./context/context.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { ApiExceptionFilter } from "./errors/api-exception.filter.js";
import { HealthModule } from "./health/health.module.js";
import { IdempotencyModule } from "./idempotency/idempotency.module.js";
import { IdentityModule } from "./identity/identity.module.js";
import { IntakeModule } from "./intake/intake.module.js";
import { DocumentsModule } from "./documents/documents.module.js";
import { ObjectStorageModule } from "./object-storage/object-storage.module.js";

@Module({
  imports: [
    ConfigurationModule,
    ContextModule,
    DatabaseModule,
    AuthModule,
    HealthModule,
    IdentityModule,
    IdempotencyModule,
    ObjectStorageModule,
    DocumentsModule,
    IntakeModule,
    CommercialModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_GUARD, useExisting: DevelopmentAuthGuard },
    { provide: APP_GUARD, useExisting: PermissionsGuard },
  ],
})
export class AppModule {}
