"use client";

import type { components } from "@ldg/api-client";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock3,
  FileText,
  Mail,
  RefreshCw,
  Send,
  ShieldAlert,
} from "lucide-react";
import { type SyntheticEvent, useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";

type Delivery = components["schemas"]["NotificationDeliveryDto"];
type Operations = components["schemas"]["CommunicationOperationsDto"];
type Template = components["schemas"]["NotificationTemplateDto"];
type State =
  | { name: "loading" }
  | { message: string; name: "error" }
  | { deliveries: Delivery[]; name: "ready"; operations: Operations; templates: Template[] };

export function CommunicationsWorkspace() {
  const [state, setState] = useState<State>({ name: "loading" });
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(async () => {
    try {
      const client = getApiClient();
      const [templates, deliveries, operations] = await Promise.all([
        client.GET("/api/v1/notification-templates"),
        client.GET("/api/v1/notifications", { params: { query: { limit: 50 } } }),
        client.GET("/api/v1/communication-operations"),
      ]);
      if (!templates.data) throw new Error(apiErrorMessage(templates.error));
      if (!deliveries.data) throw new Error(apiErrorMessage(deliveries.error));
      if (!operations.data) throw new Error(apiErrorMessage(operations.error));
      setState({
        deliveries: deliveries.data.items,
        name: "ready",
        operations: operations.data,
        templates: templates.data.items,
      });
    } catch (error) {
      setState({ message: apiErrorMessage(error), name: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (
    key: string,
    operation: () => Promise<{ error?: unknown }>,
    success: string,
  ) => {
    setBusy(key);
    setNotice(undefined);
    try {
      const response = await operation();
      if (response.error) throw new Error(apiErrorMessage(response.error));
      setNotice(success);
      await load();
    } catch (error) {
      setNotice(apiErrorMessage(error));
    } finally {
      setBusy(undefined);
    }
  };

  const createTemplate = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const templateKey = text(data, "templateKey");
    const channel = text(data, "channel") === "sms" ? "sms" : "email";
    await run(
      "create-template",
      () =>
        getApiClient().POST("/api/v1/notification-templates", {
          body: {
            allowedVariables: text(data, "allowedVariables")
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
            bodyTemplate: text(data, "bodyTemplate"),
            channel,
            name: text(data, "name"),
            ...(channel === "email" ? { subjectTemplate: text(data, "subjectTemplate") } : {}),
            templateKey,
          },
          params: { header: { "Idempotency-Key": crypto.randomUUID() } },
        }),
      `Draft ${templateKey} created.`,
    );
    form.reset();
  };

  if (state.name === "loading") {
    return (
      <div
        aria-label="Loading communications"
        className="intake-page communications-page"
        role="status"
      >
        <div className="skeleton skeleton-title" />
        <div className="communications-metrics">
          {[0, 1, 2, 3].map((item) => (
            <div className="skeleton communications-metric" key={item} />
          ))}
        </div>
      </div>
    );
  }
  if (state.name === "error") {
    return (
      <div className="intake-page communications-page">
        <div className="intake-state intake-state-error full-panel-state" role="alert">
          <AlertTriangle aria-hidden="true" size={26} />
          <h1>Communications are unavailable</h1>
          <p>{state.message}</p>
          <button className="button button-secondary" onClick={() => void load()} type="button">
            Try again
          </button>
        </div>
      </div>
    );
  }

  const { deliveries, operations, templates } = state;
  return (
    <div className="intake-page communications-page">
      <section className="intake-page-heading">
        <div>
          <span className="page-eyebrow">Customer experience</span>
          <h1>Communications</h1>
          <p>Templates, delivery evidence, reminders, and recoverable failures in one queue.</p>
        </div>
        <button className="button button-secondary" onClick={() => void load()} type="button">
          <RefreshCw aria-hidden="true" size={16} /> Refresh
        </button>
      </section>

      {notice && (
        <div aria-live="polite" className="communications-notice" role="status">
          {notice}
        </div>
      )}

      <section aria-label="Delivery totals" className="communications-metrics">
        <Metric
          icon={Clock3}
          label="Queued"
          value={operations.metrics.pending + operations.metrics.sending}
        />
        <Metric icon={CheckCircle2} label="Delivered" value={operations.metrics.delivered} />
        <Metric icon={ShieldAlert} label="Failed" value={operations.metrics.failed} />
        <Metric icon={BellRing} label="Reminders" value={operations.reminders.length} />
      </section>

      <div className="communications-layout">
        <div className="communications-main">
          <section className="panel communications-panel">
            <div className="billing-section-heading">
              <div>
                <span className="panel-kicker">Provider evidence</span>
                <h2>Delivery history</h2>
              </div>
              <span className="count-pill">{deliveries.length}</span>
            </div>
            {deliveries.length === 0 ? (
              <Empty
                icon={Send}
                title="No deliveries yet"
                copy="Committed customer notices will appear here."
              />
            ) : (
              <div className="communications-deliveries">
                {deliveries.map((delivery) => (
                  <article key={delivery.id}>
                    <span className="communications-channel">
                      <Mail aria-hidden="true" size={17} />
                    </span>
                    <div>
                      <strong>{delivery.subject ?? human(delivery.notificationType)}</strong>
                      <small>
                        {human(delivery.notificationType)} · {maskedRecipient(delivery.recipient)}
                      </small>
                      <span>
                        {delivery.attempts.length} provider{" "}
                        {delivery.attempts.length === 1 ? "attempt" : "attempts"}
                      </span>
                    </div>
                    <span className={`finance-status status-${delivery.status}`}>
                      {human(delivery.status)}
                    </span>
                    {delivery.status === "failed" ? (
                      <button
                        className="button button-secondary button-small"
                        disabled={busy === delivery.id}
                        onClick={() =>
                          void run(
                            delivery.id,
                            () =>
                              getApiClient().POST("/api/v1/notifications/{id}/actions/retry", {
                                params: {
                                  header: { "Idempotency-Key": crypto.randomUUID() },
                                  path: { id: delivery.id },
                                },
                              }),
                            "Delivery queued for retry.",
                          )
                        }
                        type="button"
                      >
                        Retry
                      </button>
                    ) : (
                      <time dateTime={delivery.createdAt}>{shortDateTime(delivery.createdAt)}</time>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel communications-panel">
            <div className="billing-section-heading">
              <div>
                <span className="panel-kicker">Controlled content</span>
                <h2>Template versions</h2>
              </div>
              <span className="count-pill">{templates.length}</span>
            </div>
            {templates.length === 0 ? (
              <Empty
                icon={FileText}
                title="No Templates"
                copy="Create the first customer-safe Template below."
              />
            ) : (
              <div className="communications-templates">
                {templates.map((template) => (
                  <article key={template.id}>
                    <div>
                      <strong>{template.name}</strong>
                      <small>
                        {template.templateKey} · {template.channel} · version {template.version}
                      </small>
                    </div>
                    <span className={`finance-status status-${template.status}`}>
                      {template.status}
                    </span>
                    {template.status === "draft" && (
                      <button
                        className="button button-secondary button-small"
                        disabled={busy === template.id}
                        onClick={() =>
                          void run(
                            template.id,
                            () =>
                              getApiClient().POST(
                                "/api/v1/notification-templates/{id}/actions/publish",
                                {
                                  params: {
                                    header: { "Idempotency-Key": crypto.randomUUID() },
                                    path: { id: template.id },
                                  },
                                },
                              ),
                            "Template published.",
                          )
                        }
                        type="button"
                      >
                        Publish
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="communications-side">
          <section className="panel communications-panel">
            <div className="billing-section-heading">
              <div>
                <span className="panel-kicker">Operations</span>
                <h2>Dead letters</h2>
              </div>
              <span className="count-pill">{operations.deadLetters.length}</span>
            </div>
            {operations.deadLetters.length === 0 ? (
              <Empty
                icon={CheckCircle2}
                title="Queue healthy"
                copy="No communication operation needs intervention."
              />
            ) : (
              <div className="dead-letter-list">
                {operations.deadLetters.map((failure) => (
                  <article key={`${failure.kind}-${failure.id}`}>
                    <ShieldAlert aria-hidden="true" size={18} />
                    <div>
                      <strong>{human(failure.operationType)}</strong>
                      <small>
                        {failure.errorCode ?? "Controlled failure"} · {failure.attempts} attempts
                      </small>
                    </div>
                    <button
                      className="button button-secondary button-small"
                      disabled={busy === failure.id}
                      onClick={() =>
                        void run(
                          failure.id,
                          () =>
                            failure.kind === "outbox"
                              ? getApiClient().POST(
                                  "/api/v1/communication-operations/outbox/{id}/actions/retry",
                                  {
                                    params: {
                                      header: { "Idempotency-Key": crypto.randomUUID() },
                                      path: { id: failure.id },
                                    },
                                  },
                                )
                              : getApiClient().POST(
                                  "/api/v1/communication-operations/scheduled-jobs/{id}/actions/retry",
                                  {
                                    params: {
                                      header: { "Idempotency-Key": crypto.randomUUID() },
                                      path: { id: failure.id },
                                    },
                                  },
                                ),
                          "Operation queued for retry.",
                        )
                      }
                      type="button"
                    >
                      Retry
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel communications-panel reminder-panel">
            <div className="billing-section-heading">
              <div>
                <span className="panel-kicker">Scheduled work</span>
                <h2>Service reminders</h2>
              </div>
            </div>
            {operations.reminders.length === 0 ? (
              <p className="quiet-panel-copy">Reminders are scheduled from confirmed Job times.</p>
            ) : (
              operations.reminders.map((reminder) => (
                <article key={reminder.id}>
                  <BellRing size={17} />
                  <div>
                    <strong>{shortDateTime(reminder.runAt)}</strong>
                    <small>
                      {human(reminder.status)} · {reminder.attempts} attempts
                    </small>
                  </div>
                </article>
              ))
            )}
          </section>

          <section className="panel template-create-panel">
            <div>
              <span className="panel-kicker">New version</span>
              <h2>Create Template draft</h2>
            </div>
            <form onSubmit={(event) => void createTemplate(event)}>
              <label>
                Template key
                <input name="templateKey" placeholder="service.reminder" required />
              </label>
              <label>
                Name
                <input name="name" placeholder="Service reminder" required />
              </label>
              <label>
                Channel
                <select defaultValue="email" name="channel">
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                </select>
              </label>
              <label>
                Subject
                <input name="subjectTemplate" placeholder="Project {{projectNumber}} reminder" />
              </label>
              <label>
                Message
                <textarea
                  name="bodyTemplate"
                  placeholder="Hello {{customerName}}…"
                  required
                  rows={4}
                />
              </label>
              <label>
                Allowed variables
                <input
                  name="allowedVariables"
                  placeholder="customerName, projectNumber, scheduledAt, secureUrl"
                  required
                />
              </label>
              <button
                className="button button-primary"
                disabled={busy === "create-template"}
                type="submit"
              >
                Create draft
              </button>
            </form>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock3;
  label: string;
  value: number;
}) {
  return (
    <article className="communications-metric">
      <Icon aria-hidden="true" size={19} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Empty({ icon: Icon, title, copy }: { icon: typeof Clock3; title: string; copy: string }) {
  return (
    <div className="billing-empty">
      <Icon aria-hidden="true" size={22} />
      <strong>{title}</strong>
      <span>{copy}</span>
    </div>
  );
}

function human(value: string): string {
  return value.replaceAll(/[._]/g, " ").replace(/^./, (character) => character.toUpperCase());
}

function maskedRecipient(value: string): string {
  const at = value.indexOf("@");
  if (at > 1) return `${value.slice(0, 1)}•••${value.slice(at)}`;
  return value.length > 4 ? `•••${value.slice(-4)}` : "Private destination";
}

function shortDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function text(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
}
