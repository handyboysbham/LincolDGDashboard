"use client";

import type { components } from "@ldg/api-client";
import { AlertTriangle, ArrowRight, FileCheck2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";
import { formatMoney, humanizeCommercialValue, shortDate } from "../lib/commercial-format";

type Quote = components["schemas"]["QuoteListItemDto"];
type State =
  { name: "loading" } | { message: string; name: "error" } | { items: Quote[]; name: "ready" };

export function QuoteWorkspace() {
  const [state, setState] = useState<State>({ name: "loading" });
  const load = useCallback(async () => {
    setState({ name: "loading" });
    const response = await getApiClient().GET("/api/v1/quotes");
    if (!response.data) setState({ message: apiErrorMessage(response.error), name: "error" });
    else setState({ items: response.data.items, name: "ready" });
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="intake-page commercial-page">
      <section className="intake-page-heading">
        <div>
          <span className="page-eyebrow">Customer offers</span>
          <h1>Quotes</h1>
          <p>Approve, deliver, and follow every commercial offer through its final state.</p>
        </div>
        <Link className="button button-secondary" href="/estimates">
          Estimate queue
        </Link>
      </section>
      {state.name === "loading" && (
        <section className="panel commercial-loading" role="status">
          <RefreshCw className="spin" size={22} /> Loading Quotes…
        </section>
      )}
      {state.name === "error" && (
        <section className="panel intake-state commercial-empty" role="alert">
          <AlertTriangle size={27} />
          <h2>Quotes unavailable</h2>
          <p>{state.message}</p>
          <button className="button button-secondary" onClick={() => void load()}>
            Try again
          </button>
        </section>
      )}
      {state.name === "ready" && state.items.length === 0 && (
        <section className="panel intake-state commercial-empty">
          <FileCheck2 size={28} />
          <h2>No Quotes yet</h2>
          <p>Approve an Estimate and create its first immutable customer offer.</p>
          <Link className="button button-primary" href="/estimates">
            Open Estimates
          </Link>
        </section>
      )}
      {state.name === "ready" && state.items.length > 0 && (
        <section className="panel commercial-record-panel">
          <div className="commercial-list-header">
            <span>Quote</span>
            <span>Service</span>
            <span>Total</span>
            <span>Status</span>
            <span />
          </div>
          {state.items.map((quote) => (
            <Link
              className="commercial-list-row"
              href={`/quotes/${quote.quoteId}`}
              key={quote.quoteId}
            >
              <div>
                <strong>{quote.customerName}</strong>
                <small>
                  {quote.quoteNumber} · v{quote.versionNumber} · Expires{" "}
                  {shortDate(quote.expiresAt)}
                </small>
              </div>
              <span>{humanizeCommercialValue(quote.serviceType)}</span>
              <b>{formatMoney(quote.totalCents)}</b>
              <i className={`commercial-status status-${quote.status}`}>
                {humanizeCommercialValue(quote.status)}
              </i>
              <ArrowRight size={17} />
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
