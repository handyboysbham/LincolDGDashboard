import { Module } from "@nestjs/common";

import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import {
  CustomerProjectLinksController,
  CommunicationOperationsController,
  NotificationPreferencesController,
  NotificationsController,
  NotificationTemplatesController,
  PublicCustomerProjectsController,
} from "./communications.controller.js";
import { CommunicationsService } from "./communications.service.js";
import { CustomerCapabilityTokenService } from "./customer-capability-token.service.js";
import { CustomerProjectService } from "./customer-project.service.js";

@Module({
  controllers: [
    NotificationTemplatesController,
    NotificationPreferencesController,
    NotificationsController,
    CustomerProjectLinksController,
    PublicCustomerProjectsController,
    CommunicationOperationsController,
  ],
  exports: [CommunicationsService, CustomerCapabilityTokenService],
  imports: [IdempotencyModule],
  providers: [CommunicationsService, CustomerCapabilityTokenService, CustomerProjectService],
})
export class CommunicationsModule {}
