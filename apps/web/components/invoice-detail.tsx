"use client";

import type { components } from "@ldg/api-client";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  FileClock,
  FileText,
  RefreshCw,
  Send,
} from "lucide-react";
import Link from "next/link";
import { type SyntheticEvent, useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";
import { formatMoney, humanizeCommercialValue, shortDate } from "../lib/commercial-format";
import { formText, parseMoneyInputToCents } from "../lib/finance-state";

type Invoice = components["schemas"]["InvoiceDto"];
type State =
  { name: "loading" } | { message: string; name: "error" } | { invoice: Invoice; name: "ready" };

export function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const [state, setState] = useState<State>({ name: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [customerPath, setCustomerPath] = useState<string>();
  const load = useCallback(async () => {
    const response = await getApiClient().GET("/api/v1/invoices/{id}", {
      params: { path: { id: invoiceId } },
    });
    setState(
      response.data
        ? { invoice: response.data, name: "ready" }
        : { message: apiErrorMessage(response.error), name: "error" },
    );
  }, [invoiceId]);
  useEffect(() => void load(), [load]);

  const run = async (operation: () => Promise<{ data?: Invoice; error?: unknown }>) => {
    setBusy(true);
    setActionError(undefined);
    try {
      const response = await operation();
      if (!response.data) throw new Error(apiErrorMessage(response.error));
      setState({ invoice: response.data, name: "ready" });
    } catch (error) {
      setActionError(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (state.name === "loading") {
    return (
      <div className="intake-page billing-page">
        <section className="panel commercial-loading" role="status">
          <RefreshCw className="spin" size={22} /> Loading Invoice…
        </section>
      </div>
    );
  }
  if (state.name === "error") {
    return (
      <div className="intake-page billing-page">
        <section className="panel intake-state commercial-empty" role="alert">
          <AlertTriangle size={28} />
          <h1>Invoice unavailable</h1>
          <p>{state.message}</p>
          <Link className="button button-secondary" href="/billing">
            Back to Billing
          </Link>
        </section>
      </div>
    );
  }

  const { invoice } = state;
  const currentVersion = invoice.versions.at(-1);
  const primaryAction =
    currentVersion?.status === "draft"
      ? "prepare"
      : currentVersion?.status === "ready_to_post"
        ? "post"
        : undefined;
  const runVersionAction = () => {
    if (!currentVersion || !primaryAction) return;
    if (primaryAction === "prepare") {
      void run(() =>
        getApiClient().POST("/api/v1/invoice-versions/{id}/actions/prepare", {
          params: {
            header: { "Idempotency-Key": crypto.randomUUID() },
            path: { id: currentVersion.id },
          },
        }),
      );
    } else {
      void run(() =>
        getApiClient().POST("/api/v1/invoice-versions/{id}/actions/post", {
          params: {
            header: { "Idempotency-Key": crypto.randomUUID() },
            path: { id: currentVersion.id },
          },
        }),
      );
    }
  };

  const share = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const recipient = formText(new FormData(event.currentTarget), "recipient");
    setBusy(true);
    setActionError(undefined);
    const response = await getApiClient().POST("/api/v1/invoices/{id}/public-links", {
      body: { expiresInDays: 14, recipient },
      params: {
        header: { "Idempotency-Key": crypto.randomUUID() },
        path: { id: invoiceId },
      },
    });
    if (!response.data) setActionError(apiErrorMessage(response.error));
    else {
      setCustomerPath(response.data.customerPath);
      setState({ invoice: response.data.invoice, name: "ready" });
    }
    setBusy(false);
  };

  const recordDelivery = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const channel = formText(form, "channel") as "email" | "link" | "manual" | "text";
    const status = formText(form, "status") as "delivered" | "failed" | "sent";
    const failureReason = formText(form, "failureReason");
    await run(() =>
      getApiClient().POST("/api/v1/invoices/{id}/deliveries", {
        body: {
          channel,
          destination: formText(form, "destination"),
          ...(failureReason ? { failureReason } : {}),
          status,
        },
        params: {
          header: { "Idempotency-Key": crypto.randomUUID() },
          path: { id: invoiceId },
        },
      }),
    );
  };

  const createAdjustment = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amountCents = parseMoneyInputToCents(form.get("amount"));
    if (!amountCents) {
      setActionError("Enter a positive amount with no more than two decimal places.");
      return;
    }
    await run(() =>
      getApiClient().POST("/api/v1/invoices/{id}/adjustments", {
        body: {
          adjustmentType: formText(form, "adjustmentType") as
            "additional_charge" | "credit" | "tax_adjustment" | "write_off",
          amountCents,
          reason: formText(form, "reason"),
        },
        params: {
          header: { "Idempotency-Key": crypto.randomUUID() },
          path: { id: invoiceId },
        },
      }),
    );
  };

  const adjustmentAction = (adjustmentId: string, action: "approve" | "post") => {
    if (action === "approve") {
      void run(() =>
        getApiClient().POST("/api/v1/invoice-adjustments/{id}/actions/approve", {
          params: {
            header: { "Idempotency-Key": crypto.randomUUID() },
            path: { id: adjustmentId },
          },
        }),
      );
    } else {
      void run(() =>
        getApiClient().POST("/api/v1/invoice-adjustments/{id}/actions/post", {
          params: {
            header: { "Idempotency-Key": crypto.randomUUID() },
            path: { id: adjustmentId },
          },
        }),
      );
    }
  };
  const revokeLink = (linkId: string) => {
    void run(() =>
      getApiClient().POST("/api/v1/invoices/{id}/public-links/{linkId}/actions/revoke", {
        params: {
          header: { "Idempotency-Key": crypto.randomUUID() },
          path: { id: invoiceId, linkId },
        },
      }),
    );
  };

  return (
    <div className="intake-page billing-page">
      <section className="lead-detail-heading billing-detail-heading">
        <div>
          <Link className="back-link" href="/billing">
            <ArrowLeft size={15} /> Billing
          </Link>
          <span className="page-eyebrow">
            {humanizeCommercialValue(invoice.invoiceType)} Invoice
          </span>
          <h1>{invoice.invoiceNumber}</h1>
          <p>
            {invoice.customerName} · {invoice.projectNumber}
            {invoice.jobNumber ? ` · ${invoice.jobNumber}` : ""}
          </p>
        </div>
        <div className="commercial-action-row">
          <span className={`finance-status status-${invoice.status}`}>
            {humanizeCommercialValue(invoice.status)}
          </span>
          {primaryAction && (
            <button
              className="button button-primary"
              disabled={busy}
              onClick={runVersionAction}
              type="button"
            >
              <CheckCircle2 size={16} />{" "}
              {primaryAction === "prepare" ? "Prepare Invoice" : "Post Invoice"}
            </button>
          )}
        </div>
      </section>

      {actionError && (
        <div className="inline-form-error" role="alert">
          <AlertTriangle size={17} /> {actionError}
        </div>
      )}
      {customerPath && (
        <div className="secure-link-banner">
          <FileText size={18} />
          <div>
            <strong>Secure Invoice link created</strong>
            <span>{new URL(customerPath, window.location.origin).toString()}</span>
          </div>
          <button
            aria-label="Copy customer Invoice link"
            onClick={() =>
              void navigator.clipboard.writeText(
                new URL(customerPath, window.location.origin).toString(),
              )
            }
            type="button"
          >
            <Copy size={16} />
          </button>
        </div>
      )}

      <section className="panel finance-summary-grid">
        <div>
          <span>Invoice total</span>
          <strong>{formatMoney(invoice.totalCents ?? 0)}</strong>
        </div>
        <div>
          <span>Outstanding</span>
          <strong>{formatMoney(invoice.outstandingBalanceCents)}</strong>
        </div>
        <div>
          <span>Issued</span>
          <strong>{shortDate(invoice.issueDate)}</strong>
        </div>
        <div>
          <span>Due</span>
          <strong>{shortDate(invoice.dueDate)}</strong>
        </div>
      </section>

      <div className="billing-detail-grid">
        <main className="operations-stack">
          <section className="panel billing-document">
            <div className="billing-section-heading">
              <div>
                <span className="page-eyebrow">Version {currentVersion?.versionNumber ?? "—"}</span>
                <h2>Customer charges</h2>
              </div>
              <span className="finance-status">
                {humanizeCommercialValue(currentVersion?.status ?? "unavailable")}
              </span>
            </div>
            {currentVersion?.lines.map((line) => (
              <div className="invoice-line-row" key={line.id}>
                <div>
                  <strong>{line.description}</strong>
                  <small>
                    {line.quantity
                      ? `${line.quantity} ${humanizeCommercialValue(line.unit ?? "unit")}`
                      : humanizeCommercialValue(line.lineType)}
                  </small>
                </div>
                <span>
                  {line.direction === "credit" ? "−" : ""}
                  {formatMoney(line.totalCents)}
                </span>
              </div>
            ))}
            <div className="invoice-total-row">
              <span>Version total</span>
              <strong>{formatMoney(currentVersion?.totalCents ?? 0)}</strong>
            </div>
          </section>

          <section className="panel operations-section">
            <div className="billing-section-heading">
              <div>
                <span className="page-eyebrow">Corrections</span>
                <h2>Adjustments</h2>
              </div>
              <span className="count-pill">{invoice.adjustments.length}</span>
            </div>
            {invoice.adjustments.map((adjustment) => (
              <div className="finance-ledger-row" key={adjustment.id}>
                <div>
                  <strong>{humanizeCommercialValue(adjustment.adjustmentType)}</strong>
                  <small>
                    {adjustment.adjustmentNumber} · {adjustment.reason}
                  </small>
                </div>
                <b>
                  {adjustment.direction === "credit" ? "−" : "+"}
                  {formatMoney(adjustment.amountCents)}
                </b>
                <span className="finance-status">{humanizeCommercialValue(adjustment.status)}</span>
                {adjustment.status === "pending_approval" && (
                  <button
                    className="button button-small"
                    disabled={busy}
                    onClick={() => {
                      adjustmentAction(adjustment.id, "approve");
                    }}
                    type="button"
                  >
                    Approve
                  </button>
                )}
                {adjustment.status === "approved" && (
                  <button
                    className="button button-small"
                    disabled={busy}
                    onClick={() => {
                      adjustmentAction(adjustment.id, "post");
                    }}
                    type="button"
                  >
                    Post
                  </button>
                )}
              </div>
            ))}
            {currentVersion?.status === "posted" &&
              !["replaced", "voided"].includes(invoice.status) && (
                <form
                  className="finance-inline-form"
                  onSubmit={(event) => void createAdjustment(event)}
                >
                  <label>
                    Type
                    <select name="adjustmentType">
                      <option value="credit">Credit</option>
                      <option value="additional_charge">Additional charge</option>
                      <option value="tax_adjustment">Tax adjustment</option>
                      <option value="write_off">Write-off</option>
                    </select>
                  </label>
                  <label>
                    Amount
                    <input inputMode="decimal" name="amount" placeholder="0.00" required />
                  </label>
                  <label className="wide-field">
                    Reason
                    <input maxLength={1000} name="reason" required />
                  </label>
                  <button className="button button-secondary" disabled={busy}>
                    Create adjustment
                  </button>
                </form>
              )}
          </section>
        </main>

        <aside className="operations-stack">
          {currentVersion?.status === "posted" &&
            !["replaced", "voided"].includes(invoice.status) && (
              <section className="panel operations-section">
                <Send size={22} />
                <h2>Share secure Invoice</h2>
                <p>Create a private 14-day customer link and record delivery evidence.</p>
                <form className="compact-form" onSubmit={(event) => void share(event)}>
                  <label>
                    Customer email
                    <input autoComplete="email" name="recipient" required type="email" />
                  </label>
                  <button className="button button-primary" disabled={busy}>
                    <Send size={16} /> Create secure link
                  </button>
                </form>
                {invoice.publicLinks.map((link) => (
                  <div className="invoice-link-row" key={link.id}>
                    <div>
                      <strong>{link.recipient}</strong>
                      <small>
                        {link.viewCount} views · expires {shortDate(link.expiresAt)}
                      </small>
                    </div>
                    {link.revokedAt ? (
                      <span className="finance-status status-reversed">Revoked</span>
                    ) : (
                      <button
                        className="button button-small"
                        disabled={busy}
                        onClick={() => {
                          revokeLink(link.id);
                        }}
                        type="button"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </section>
            )}
          <section className="panel operations-section">
            <FileClock size={22} />
            <h2>Delivery evidence</h2>
            {invoice.deliveries.length === 0 ? (
              <p className="muted-copy">No delivery attempts recorded.</p>
            ) : (
              invoice.deliveries.map((delivery) => (
                <div className="delivery-evidence-row" key={delivery.id}>
                  <span className={`evidence-dot is-${delivery.status}`} />
                  <div>
                    <strong>
                      {humanizeCommercialValue(delivery.channel)} ·{" "}
                      {humanizeCommercialValue(delivery.status)}
                    </strong>
                    <small>
                      {shortDate(
                        delivery.viewedAt ??
                          delivery.deliveredAt ??
                          delivery.sentAt ??
                          delivery.attemptedAt,
                      )}
                    </small>
                  </div>
                </div>
              ))
            )}
            {currentVersion?.status === "posted" && (
              <form className="compact-form" onSubmit={(event) => void recordDelivery(event)}>
                <label>
                  Channel
                  <select name="channel">
                    <option value="email">Email</option>
                    <option value="text">Text</option>
                    <option value="manual">Manual</option>
                    <option value="link">Link</option>
                  </select>
                </label>
                <label>
                  Destination
                  <input name="destination" required />
                </label>
                <label>
                  Result
                  <select name="status">
                    <option value="sent">Sent</option>
                    <option value="delivered">Delivered</option>
                    <option value="failed">Failed</option>
                  </select>
                </label>
                <label>
                  Failure reason (only if failed)
                  <input name="failureReason" />
                </label>
                <button className="button button-secondary" disabled={busy}>
                  Record evidence
                </button>
              </form>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
