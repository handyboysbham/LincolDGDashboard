import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";

import { AdministrationModule } from "./administration/administration.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { AuthenticationGuard } from "./auth/authentication.guard.js";
import { PermissionsGuard } from "./auth/permissions.guard.js";
import { CommercialModule } from "./commercial/commercial.module.js";
import { CommunicationsModule } from "./communications/communications.module.js";
import { ConfigurationModule } from "./config/configuration.module.js";
import { ContextModule } from "./context/context.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { ApiExceptionFilter } from "./errors/api-exception.filter.js";
import { HealthModule } from "./health/health.module.js";
import { IdempotencyModule } from "./idempotency/idempotency.module.js";
import { IdentityModule } from "./identity/identity.module.js";
import { IntakeModule } from "./intake/intake.module.js";
import { DocumentsModule } from "./documents/documents.module.js";
import { FinanceModule } from "./finance/finance.module.js";
import { ObjectStorageModule } from "./object-storage/object-storage.module.js";
import { OperationsModule } from "./operations/operations.module.js";

@Module({
  imports: [
    ConfigurationModule,
    ContextModule,
    DatabaseModule,
    AuthModule,
    AdministrationModule,
    HealthModule,
    IdentityModule,
    IdempotencyModule,
    ObjectStorageModule,
    DocumentsModule,
    IntakeModule,
    OperationsModule,
    CommercialModule,
    FinanceModule,
    CommunicationsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_GUARD, useExisting: AuthenticationGuard },
    { provide: APP_GUARD, useExisting: PermissionsGuard },
  ],
})
export class AppModule {}
