import { Injectable } from "@nestjs/common";
import type { ClaimedOutboxEvent } from "@ldg/database";

export interface OutboxHandler {
  handle(event: ClaimedOutboxEvent): Promise<void>;
}

@Injectable()
export class OutboxHandlerRegistry {
  private readonly handlers = new Map<string, OutboxHandler>();

  public register(eventType: string, handler: OutboxHandler): void {
    if (!eventType) throw new Error("Outbox event type is required");
    if (this.handlers.has(eventType)) {
      throw new Error(`Outbox handler already registered for ${eventType}`);
    }
    this.handlers.set(eventType, handler);
  }

  public async handle(event: ClaimedOutboxEvent): Promise<void> {
    const handler = this.handlers.get(event.eventType);
    if (!handler) {
      throw new Error("UnregisteredOutboxEvent");
    }
    await handler.handle(event);
  }
}
