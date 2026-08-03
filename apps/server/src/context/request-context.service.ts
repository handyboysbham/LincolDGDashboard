import { Injectable } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestActor {
  permissions: ReadonlySet<string>;
  tenantId: string;
  userId: string;
}

interface RequestStore {
  actor?: RequestActor;
  correlationId: string;
}

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestStore>();

  public run<T>(correlationId: string, operation: () => T): T {
    return this.storage.run({ correlationId }, operation);
  }

  public setActor(actor: RequestActor): void {
    this.requireStore().actor = actor;
  }

  public correlationId(): string {
    return this.requireStore().correlationId;
  }

  public actor(): RequestActor {
    const actor = this.requireStore().actor;
    if (!actor) {
      throw new Error("Authenticated actor is not available in request context");
    }
    return actor;
  }

  private requireStore(): RequestStore {
    const store = this.storage.getStore();
    if (!store) {
      throw new Error("Request context is not available");
    }
    return store;
  }
}
