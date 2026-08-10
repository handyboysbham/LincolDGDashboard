import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

import { ServerConfigService } from "../config/server-config.service.js";
import type { NotificationChannel } from "./communications.dto.js";

export const NOTIFICATION_PROVIDER = Symbol("NOTIFICATION_PROVIDER");

export interface SendNotificationInput {
  body: string;
  channel: NotificationChannel;
  idempotencyKey: string;
  recipient: string;
  subject: string | null;
}

export interface SendNotificationResult {
  providerMessageId: string;
}

export interface NotificationProvider {
  readonly name: string;
  providerName?(channel: NotificationChannel): string;
  send(input: SendNotificationInput): Promise<SendNotificationResult>;
}

export class NotificationProviderError extends Error {
  public override readonly name = "NotificationProviderError";

  public constructor(
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super("Notification provider request failed");
  }
}

/** Local capture adapter. It records no message content and is replaceable by a provider adapter. */
export class CaptureNotificationProvider implements NotificationProvider {
  public readonly name = "capture";

  public send(input: SendNotificationInput): Promise<SendNotificationResult> {
    const digest = createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 24);
    return Promise.resolve({ providerMessageId: `capture-${digest}` });
  }
}

/** Routes email and SMS through configured production adapters without logging request content. */
@Injectable()
export class ConfiguredNotificationProvider implements NotificationProvider {
  public readonly name = "configured";

  public constructor(
    @Inject(ServerConfigService) private readonly configuration: ServerConfigService,
  ) {}

  public providerName(channel: NotificationChannel): string {
    const notifications = this.configuration.value.notifications;
    return channel === "email" ? notifications.emailProvider : notifications.smsProvider;
  }

  public async send(input: SendNotificationInput): Promise<SendNotificationResult> {
    const notifications = this.configuration.value.notifications;
    if (input.channel === "email") {
      if (notifications.emailProvider === "capture") return capture(input);
      return sendResend(input, notifications);
    }
    if (notifications.smsProvider === "capture") return capture(input);
    if (notifications.smsProvider === "disabled") {
      throw new NotificationProviderError("provider_not_configured", false);
    }
    return sendTwilio(input, notifications);
  }
}

function capture(input: SendNotificationInput): SendNotificationResult {
  const digest = createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 24);
  return { providerMessageId: `capture-${digest}` };
}

async function sendResend(
  input: SendNotificationInput,
  configuration: ServerConfigService["value"]["notifications"],
): Promise<SendNotificationResult> {
  if (!configuration.emailApiKey || !input.subject) {
    throw new NotificationProviderError("provider_not_configured", false);
  }
  const response = await providerFetch(
    `${configuration.emailApiUrl}/emails`,
    {
      body: JSON.stringify({
        from: configuration.emailFrom,
        subject: input.subject,
        text: input.body,
        to: [input.recipient],
      }),
      headers: {
        Authorization: `Bearer ${configuration.emailApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      method: "POST",
    },
    configuration.timeoutMs,
  );
  const payload: unknown = await response.json().catch(() => undefined);
  const providerMessageId = stringProperty(payload, "id");
  if (!providerMessageId) throw new NotificationProviderError("provider_response_invalid", true);
  return { providerMessageId };
}

async function sendTwilio(
  input: SendNotificationInput,
  configuration: ServerConfigService["value"]["notifications"],
): Promise<SendNotificationResult> {
  if (!configuration.smsAccountSid || !configuration.smsAuthToken || !configuration.smsFrom) {
    throw new NotificationProviderError("provider_not_configured", false);
  }
  const body = new URLSearchParams({
    Body: input.body,
    From: configuration.smsFrom,
    To: input.recipient,
  });
  const response = await providerFetch(
    `${configuration.twilioApiBaseUrl}/2010-04-01/Accounts/${encodeURIComponent(configuration.smsAccountSid)}/Messages.json`,
    {
      body,
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${configuration.smsAccountSid}:${configuration.smsAuthToken}`,
        ).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": input.idempotencyKey,
      },
      method: "POST",
    },
    configuration.timeoutMs,
  );
  const payload: unknown = await response.json().catch(() => undefined);
  const providerMessageId = stringProperty(payload, "sid");
  if (!providerMessageId) throw new NotificationProviderError("provider_response_invalid", true);
  return { providerMessageId };
}

async function providerFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) {
      throw new NotificationProviderError("provider_timeout", true);
    }
    throw new NotificationProviderError("provider_unavailable", true);
  }
  if (response.ok) return response;
  if (response.status === 408) throw new NotificationProviderError("provider_timeout", true);
  if (response.status === 409) {
    throw new NotificationProviderError("provider_request_in_progress", true);
  }
  if (response.status === 429) throw new NotificationProviderError("provider_rate_limited", true);
  if (response.status >= 500) throw new NotificationProviderError("provider_unavailable", true);
  throw new NotificationProviderError("provider_rejected", false);
}

function stringProperty(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" && property ? property : undefined;
}
