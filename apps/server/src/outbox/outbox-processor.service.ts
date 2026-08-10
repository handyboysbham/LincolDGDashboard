import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  claimOutboxEvents,
  completeOutboxEvent,
  failOutboxEvent,
  type ClaimedOutboxEvent,
  type Database,
  withTenantTransaction,
} from "@ldg/database";

import { ServerConfigService } from "../config/server-config.service.js";
import { DATABASE } from "../database/database.tokens.js";
import { OutboxHandlerRegistry } from "./outbox-handler.registry.js";

export class NonRetryableOutboxError extends Error {
  public override readonly name = "NonRetryableOutboxError";

  public constructor(public readonly code: string) {
    super("Outbox event cannot be retried automatically");
  }
}

@Injectable()
export class OutboxProcessorService {
  private readonly logger = new Logger(OutboxProcessorService.name);

  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ServerConfigService) private readonly configuration: ServerConfigService,
    @Inject(OutboxHandlerRegistry) private readonly handlers: OutboxHandlerRegistry,
  ) {}

  public async processOnce(tenantId: string): Promise<number> {
    const worker = this.configuration.value.worker;
    const events = await withTenantTransaction(this.database, tenantId, async (transaction) =>
      claimOutboxEvents(transaction, {
        leaseSeconds: worker.leaseSeconds,
        limit: 25,
        workerId: worker.id,
      }),
    );

    await Promise.all(events.map((event) => this.processEvent(event)));
    return events.length;
  }

  private async processEvent(event: ClaimedOutboxEvent): Promise<void> {
    try {
      await this.handlers.handle(event);
      const completed = await withTenantTransaction(
        this.database,
        event.tenantId,
        async (transaction) =>
          completeOutboxEvent(transaction, {
            eventId: event.id,
            workerId: this.configuration.value.worker.id,
          }),
      );
      if (!completed) {
        this.logger.warn(`Outbox lease was lost before completion: ${event.id}`);
      }
    } catch (error) {
      const worker = this.configuration.value.worker;
      const retryDelayMs = Math.min(2 ** Math.max(event.attempts - 1, 0) * 1_000, 300_000);
      const nonRetryable = error instanceof NonRetryableOutboxError;
      const result = await withTenantTransaction(
        this.database,
        event.tenantId,
        async (transaction) =>
          failOutboxEvent(transaction, {
            attempts: nonRetryable ? worker.maxAttempts : event.attempts,
            error: nonRetryable ? error.code : error instanceof Error ? error.name : "UnknownError",
            eventId: event.id,
            maxAttempts: worker.maxAttempts,
            retryAt: new Date(Date.now() + retryDelayMs),
            workerId: worker.id,
          }),
      );
      this.logger.warn(`Outbox event ${event.id} finished as ${result}`);
    }
  }
}
