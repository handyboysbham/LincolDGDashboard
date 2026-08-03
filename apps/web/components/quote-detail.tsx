"use client";

import type { components } from "@ldg/api-client";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Copy,
  FileCheck2,
  RefreshCw,
  RotateCcw,
  Send,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { type SyntheticEvent, useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";
import { formatMoney, humanizeCommercialValue, shortDate } from "../lib/commercial-format";

type Quote = components["schemas"]["QuoteVersionDto"];
type State =
  { name: "loading" } | { message: string; name: "error" } | { quote: Quote; name: "ready" };

export function QuoteDetail({ quoteId }: { quoteId: string }) {
  const [state, setState] = useState<State>({ name: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [customerPath, setCustomerPath] = useState<string>();

  const load = useCallback(async () => {
    const response = await getApiClient().GET("/api/v1/quotes/{id}", {
      params: { path: { id: quoteId } },
    });
    if (!response.data) setState({ message: apiErrorMessage(response.error), name: "error" });
    else setState({ quote: response.data, name: "ready" });
  }, [quoteId]);
  useEffect(() => {
    void load();
  }, [load]);

  const command = async (action: "approve" | "expire" | "withdraw") => {
    if (state.name !== "ready") return;
    setBusy(true);
    setActionError(undefined);
    const params = {
      header: { "Idempotency-Key": crypto.randomUUID() },
      path: { id: state.quote.id },
    };
    try {
      const response =
        action === "approve"
          ? await getApiClient().POST("/api/v1/quote-versions/{id}/actions/approve", { params })
          : action === "withdraw"
            ? await getApiClient().POST("/api/v1/quote-versions/{id}/actions/withdraw", { params })
            : await getApiClient().POST("/api/v1/quote-versions/{id}/actions/expire", { params });
      if (!response.data) throw new Error(apiErrorMessage(response.error));
      setState({ quote: response.data, name: "ready" });
    } catch (error) {
      setActionError(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const sendQuote = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.name !== "ready") return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const channel = data.get("channel") as "email" | "link" | "text";
    const recipientValue = data.get("recipient");
    const recipient = typeof recipientValue === "string" ? recipientValue.trim() : "";
    setBusy(true);
    setActionError(undefined);
    try {
      const response = await getApiClient().POST("/api/v1/quote-versions/{id}/actions/send", {
        body: { channel, expiresInDays: Number(data.get("expiresInDays")), recipient },
        params: {
          header: { "Idempotency-Key": crypto.randomUUID() },
          path: { id: state.quote.id },
        },
      });
      if (!response.data) throw new Error(apiErrorMessage(response.error));
      setState({ quote: response.data.quote, name: "ready" });
      setCustomerPath(response.data.customerPath);
    } catch (error) {
      setActionError(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const revise = async () => {
    setBusy(true);
    setActionError(undefined);
    try {
      const response = await getApiClient().POST("/api/v1/quotes/{id}/actions/revise", {
        params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: quoteId } },
      });
      if (!response.data) throw new Error(apiErrorMessage(response.error));
      setState({ quote: response.data, name: "ready" });
      setCustomerPath(undefined);
    } catch (error) {
      setActionError(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (state.name === "loading")
    return (
      <div className="intake-page">
        <section className="panel commercial-loading">
          <RefreshCw className="spin" size={22} /> Loading Quote…
        </section>
      </div>
    );
  if (state.name === "error")
    return (
      <div className="intake-page">
        <section className="panel intake-state commercial-empty" role="alert">
          <AlertTriangle size={27} />
          <h1>Quote unavailable</h1>
          <p>{state.message}</p>
          <Link className="button button-secondary" href="/quotes">
            Back to Quotes
          </Link>
        </section>
      </div>
    );
  const { quote } = state;
  const mayRevise = !["accepted", "draft"].includes(quote.status);
  return (
    <div className="intake-page commercial-page">
      <section className="lead-detail-heading">
        <div>
          <Link className="back-link" href="/quotes">
            <ArrowLeft size={15} /> Quotes
          </Link>
          <span className="page-eyebrow">
            {quote.quoteNumber} · version {quote.versionNumber}
          </span>
          <h1>{quote.customerName}</h1>
          <p>
            {humanizeCommercialValue(quote.serviceType)} · {quote.locationLabel}
          </p>
        </div>
        <div className="commercial-action-row">
          <span className={`commercial-status status-${quote.status}`}>
            {humanizeCommercialValue(quote.status)}
          </span>
          {quote.status === "draft" && (
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => void command("approve")}
            >
              <CheckCircle2 size={16} /> Approve Quote
            </button>
          )}
          {mayRevise && (
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => void revise()}
            >
              <RotateCcw size={16} /> Revise
            </button>
          )}
          {["sent", "viewed"].includes(quote.status) && (
            <button
              className="button button-secondary danger-button"
              disabled={busy}
              onClick={() => void command("withdraw")}
            >
              <XCircle size={16} /> Withdraw
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
          <FileCheck2 size={18} />
          <div>
            <strong>Secure customer link created</strong>
            <span>{new URL(customerPath, window.location.origin).toString()}</span>
          </div>
          <button
            aria-label="Copy customer link"
            onClick={() =>
              void navigator.clipboard.writeText(
                new URL(customerPath, window.location.origin).toString(),
              )
            }
          >
            <Copy size={16} />
          </button>
        </div>
      )}
      <div className="commercial-detail-grid">
        <main className="commercial-side-stack">
          <section className="panel quote-preview">
            <div className="quote-preview-header">
              <div>
                <span>Lincoln Dirt &amp; Gravel</span>
                <h2>Quote {quote.quoteNumber}</h2>
              </div>
              <div>
                <small>Prepared for</small>
                <strong>{quote.customerName}</strong>
              </div>
            </div>
            <div className="quote-scope">
              <span>Scope</span>
              <p>{quote.scope}</p>
            </div>
            <div className="quote-line-header">
              <span>Description</span>
              <span>Quantity</span>
              <span>Total</span>
            </div>
            {quote.lineItems.map((line) => (
              <div className="quote-line" key={line.id}>
                <div>
                  <strong>{line.description}</strong>
                  <small>
                    {formatMoney(line.unitPriceCents)} / {humanizeCommercialValue(line.unit)}
                  </small>
                </div>
                <span>{line.quantity}</span>
                <b>{formatMoney(line.totalCents)}</b>
              </div>
            ))}
            <div className="quote-totals">
              <div>
                <span>Subtotal</span>
                <b>{formatMoney(quote.subtotalCents)}</b>
              </div>
              {quote.adjustmentCents !== 0 && (
                <div>
                  <span>Adjustment</span>
                  <b>{formatMoney(quote.adjustmentCents)}</b>
                </div>
              )}
              <div>
                <span>Tax</span>
                <b>{formatMoney(quote.taxCents)}</b>
              </div>
              <div className="grand-total">
                <span>Total</span>
                <b>{formatMoney(quote.totalCents)}</b>
              </div>
              <div>
                <span>Required deposit</span>
                <b>{formatMoney(quote.requiredDepositCents)}</b>
              </div>
            </div>
            {quote.terms.map((term) => (
              <article className="quote-term" key={term.id}>
                <strong>{term.title}</strong>
                <p>{term.body}</p>
              </article>
            ))}
          </section>
        </main>
        <aside className="commercial-side-stack">
          {quote.status === "ready_to_send" && (
            <form
              className="panel quote-send-form"
              onSubmit={(event) => {
                void sendQuote(event);
              }}
            >
              <div className="panel-heading compact">
                <div>
                  <span className="panel-kicker">Secure delivery</span>
                  <h2>Send Quote</h2>
                </div>
                <Send size={18} />
              </div>
              <label className="field">
                <span>Channel</span>
                <select name="channel">
                  <option value="email">Email</option>
                  <option value="text">Text message</option>
                  <option value="link">Copy link</option>
                </select>
              </label>
              <label className="field">
                <span>Recipient</span>
                <input defaultValue={quote.customerEmail} name="recipient" required />
              </label>
              <label className="field">
                <span>Expires in days</span>
                <input
                  defaultValue="10"
                  max="30"
                  min="1"
                  name="expiresInDays"
                  type="number"
                  required
                />
              </label>
              <button className="button button-primary" disabled={busy} type="submit">
                <Send size={16} /> Create secure delivery
              </button>
            </form>
          )}
          <section className="panel commercial-summary-panel">
            <div className="panel-heading compact">
              <div>
                <span className="panel-kicker">Lifecycle</span>
                <h2>Offer status</h2>
              </div>
              <Clock3 size={18} />
            </div>
            <dl className="commercial-definition-list">
              <div>
                <dt>Issued</dt>
                <dd>{shortDate(quote.issuedAt)}</dd>
              </div>
              <div>
                <dt>Expires</dt>
                <dd>{shortDate(quote.expiresAt)}</dd>
              </div>
              <div>
                <dt>Viewed</dt>
                <dd>{shortDate(quote.viewedAt)}</dd>
              </div>
              <div>
                <dt>Content hash</dt>
                <dd className="hash-value">{quote.contentHash}</dd>
              </div>
            </dl>
            {quote.expiresAt &&
              new Date(quote.expiresAt) <= new Date() &&
              ["sent", "viewed"].includes(quote.status) && (
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => void command("expire")}
                >
                  <Clock3 size={16} /> Mark expired
                </button>
              )}
          </section>
          <section className="panel commercial-summary-panel">
            <div className="panel-heading compact">
              <div>
                <span className="panel-kicker">Delivery history</span>
                <h2>{quote.deliveries.length} deliveries</h2>
              </div>
            </div>
            {quote.deliveries.length === 0 ? (
              <p className="quiet-panel-copy">Not sent yet.</p>
            ) : (
              quote.deliveries.map((delivery) => (
                <article className="delivery-row" key={delivery.id}>
                  <Send size={14} />
                  <div>
                    <strong>{humanizeCommercialValue(delivery.channel)}</strong>
                    <span>
                      {delivery.recipient} · {shortDate(delivery.sentAt)}
                    </span>
                  </div>
                </article>
              ))
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
