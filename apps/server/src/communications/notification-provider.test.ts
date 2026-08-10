import { afterEach, describe, expect, it, vi } from "vitest";

import type { ServerConfig } from "../config/server-config.js";
import type { ServerConfigService } from "../config/server-config.service.js";
import {
  ConfiguredNotificationProvider,
  NotificationProviderError,
} from "./notification-provider.js";

const notificationConfig: ServerConfig["notifications"] = {
  emailApiKey: "provider-secret",
  emailApiUrl: "https://email.example.test",
  emailFrom: "Lincoln D&G <office@example.test>",
  emailProvider: "resend",
  reminderLeadMinutes: 1440,
  smsAccountSid: null,
  smsAuthToken: null,
  smsFrom: null,
  smsProvider: "disabled",
  timeoutMs: 5_000,
  twilioApiBaseUrl: "https://sms.example.test",
};

describe("ConfiguredNotificationProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends email with provider idempotency and returns only the provider identifier", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email-message-1" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", request);
    const provider = new ConfiguredNotificationProvider(configured(notificationConfig));

    await expect(
      provider.send({
        body: "Customer-safe message",
        channel: "email",
        idempotencyKey: "notification:one",
        recipient: "customer@example.test",
        subject: "Project update",
      }),
    ).resolves.toEqual({ providerMessageId: "email-message-1" });
    expect(provider.providerName("email")).toBe("resend");
    expect(request).toHaveBeenCalledOnce();
    const init = request.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({
      Authorization: "Bearer provider-secret",
      "Idempotency-Key": "notification:one",
    });
  });

  it("classifies provider rejection as permanent without retaining the response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("credential-and-recipient-details", { status: 400 })),
    );
    const provider = new ConfiguredNotificationProvider(configured(notificationConfig));

    const error = await provider
      .send({
        body: "Message",
        channel: "email",
        idempotencyKey: "notification:two",
        recipient: "customer@example.test",
        subject: "Update",
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NotificationProviderError);
    expect(error).toMatchObject({ code: "provider_rejected", retryable: false });
    expect(JSON.stringify(error)).not.toContain("credential-and-recipient-details");
  });

  it("classifies timeouts as retryable and disabled SMS as permanent", async () => {
    const timeout = new Error("request contents must not escape");
    timeout.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout));
    const provider = new ConfiguredNotificationProvider(configured(notificationConfig));

    await expect(
      provider.send({
        body: "Message",
        channel: "email",
        idempotencyKey: "notification:three",
        recipient: "customer@example.test",
        subject: "Update",
      }),
    ).rejects.toMatchObject({ code: "provider_timeout", retryable: true });
    await expect(
      provider.send({
        body: "Message",
        channel: "sms",
        idempotencyKey: "notification:four",
        recipient: "+14025550142",
        subject: null,
      }),
    ).rejects.toMatchObject({ code: "provider_not_configured", retryable: false });
  });

  it("retries concurrent and rate-limited provider requests", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", request);
    const provider = new ConfiguredNotificationProvider(configured(notificationConfig));
    const input = {
      body: "Message",
      channel: "email" as const,
      idempotencyKey: "notification:five",
      recipient: "customer@example.test",
      subject: "Update",
    };

    await expect(provider.send(input)).rejects.toMatchObject({
      code: "provider_request_in_progress",
      retryable: true,
    });
    await expect(provider.send(input)).rejects.toMatchObject({
      code: "provider_rate_limited",
      retryable: true,
    });
  });
});

function configured(notifications: ServerConfig["notifications"]): ServerConfigService {
  return { value: { notifications } as ServerConfig };
}
