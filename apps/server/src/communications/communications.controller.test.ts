import { describe, expect, it } from "vitest";

import { REQUIRED_PERMISSIONS } from "../auth/require-permissions.decorator.js";
import {
  CommunicationOperationsController,
  CustomerProjectLinksController,
  NotificationPreferencesController,
  NotificationsController,
  NotificationTemplatesController,
} from "./communications.controller.js";

describe("communications controller authorization", () => {
  it.each([
    [NotificationTemplatesController, "list", ["communications:read"]],
    [NotificationTemplatesController, "create", ["communications:manage"]],
    [NotificationTemplatesController, "publish", ["communications:manage"]],
    [NotificationPreferencesController, "list", ["communications:read"]],
    [NotificationPreferencesController, "set", ["communications:manage"]],
    [NotificationsController, "list", ["communications:read"]],
    [NotificationsController, "get", ["communications:read"]],
    [NotificationsController, "retry", ["communications:manage"]],
    [NotificationsController, "queue", ["communications:send"]],
    [CommunicationOperationsController, "get", ["communications:read"]],
    [CommunicationOperationsController, "retryDeadLetter", ["communications:manage"]],
    [CommunicationOperationsController, "retryReminder", ["communications:manage"]],
    [CustomerProjectLinksController, "create", ["communications:manage"]],
    [CustomerProjectLinksController, "revoke", ["communications:manage"]],
  ] as const)("requires explicit permissions for %s.%s", (controller, method, expected) => {
    const handler = (controller.prototype as unknown as Record<string, unknown>)[method];
    expect(handler).toBeTypeOf("function");
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler as object)).toEqual(expected);
  });
});
