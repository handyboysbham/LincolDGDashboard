import { Module } from "@nestjs/common";

import { OutboxModule } from "../outbox/outbox.module.js";
import { NotificationOutboxHandler } from "./notification-outbox.handler.js";
import { NotificationReminderHandler } from "./notification-reminder.handler.js";
import { ScheduledJobsModule } from "../scheduled/scheduled-jobs.module.js";
import { ConfiguredNotificationProvider, NOTIFICATION_PROVIDER } from "./notification-provider.js";
import { CustomerCapabilityTokenService } from "./customer-capability-token.service.js";
import { NotificationPolicyHandler } from "./notification-policy.handler.js";

@Module({
  imports: [OutboxModule, ScheduledJobsModule],
  providers: [
    NotificationOutboxHandler,
    NotificationPolicyHandler,
    NotificationReminderHandler,
    CustomerCapabilityTokenService,
    { provide: NOTIFICATION_PROVIDER, useClass: ConfiguredNotificationProvider },
  ],
})
export class CommunicationsWorkerModule {}
