"use client";

import type { components } from "@ldg/api-client";
import {
  CheckCircle2,
  CircleAlert,
  FileText,
  LoaderCircle,
  Phone,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";

import { apiErrorCode, apiErrorMessage, getApiClient } from "../lib/api-client";
import { formatMoney, humanizeCommercialValue, shortDate } from "../lib/commercial-format";

type Invoice = components["schemas"]["PublicInvoiceDto"];
type State =
  | { name: "loading" }
  | { code?: string; message: string; name: "failure" }
  | { invoice: Invoice; name: "ready" };

export function PublicInvoiceCard({ token }: { token: string }) {
  const [state, setState] = useState<State>({ name: "loading" });
  useEffect(() => {
    let active = true;
    void getApiClient()
      .GET("/api/v1/public/invoices/{token}", {
        params: { path: { token } },
        referrerPolicy: "no-referrer",
      })
      .then((response) => {
        if (!active) return;
        if (response.data) setState({ invoice: response.data, name: "ready" });
        else {
          const code = apiErrorCode(response.error);
          setState({
            ...(code ? { code } : {}),
            message: apiErrorMessage(response.error),
            name: "failure",
          });
        }
      })
      .catch((error: unknown) => {
        if (active) setState({ message: apiErrorMessage(error), name: "failure" });
      });
    return () => {
      active = false;
    };
  }, [token]);

  if (state.name === "loading")
    return (
      <div aria-live="polite" className="customer-state-card">
        <span className="customer-state-icon">
          <LoaderCircle className="spin" />
        </span>
        <span className="page-eyebrow">Secure Invoice</span>
        <h1>Checking your Invoice…</h1>
        <p>We’re verifying this private link and current posted Invoice Version.</p>
      </div>
    );
  if (state.name === "failure") {
    const expired = state.code === "INVOICE_LINK_EXPIRED";
    const revoked = state.code === "INVOICE_LINK_REVOKED" || state.code === "INVOICE_UNAVAILABLE";
    return (
      <div className="customer-state-card">
        <span className="customer-state-icon is-error">
          <CircleAlert />
        </span>
        <span className="page-eyebrow">Invoice unavailable</span>
        <h1>
          {expired
            ? "This Invoice link has expired."
            : revoked
              ? "This Invoice link is no longer active."
              : "We can’t open this Invoice."}
        </h1>
        <p>
          {expired || revoked
            ? "Contact Lincoln Dirt & Gravel for a current secure link."
            : state.message}
        </p>
        <a className="button button-primary customer-contact" href="tel:+14025550142">
          <Phone size={17} /> Call (402) 555-0142
        </a>
      </div>
    );
  }

  const { invoice } = state;
  return (
    <article className="public-quote-card public-invoice-card">
      <header className="public-quote-heading">
        <div>
          <span className="page-eyebrow">Invoice {invoice.invoiceNumber}</span>
          <h1>{invoice.customerName}</h1>
          <p>
            {invoice.projectNumber}
            {invoice.jobNumber ? ` · ${invoice.jobNumber}` : ""}
          </p>
        </div>
        <div className="public-invoice-status">
          <FileText size={24} />
          <span>{humanizeCommercialValue(invoice.invoiceType)}</span>
          <strong>{humanizeCommercialValue(invoice.status)}</strong>
        </div>
      </header>
      <section className="public-invoice-dates">
        <div>
          <span>Issued</span>
          <strong>{shortDate(invoice.issueDate)}</strong>
        </div>
        <div>
          <span>Due</span>
          <strong>{shortDate(invoice.dueDate)}</strong>
        </div>
        <div>
          <span>Version</span>
          <strong>{invoice.versionNumber}</strong>
        </div>
      </section>
      <section className="public-quote-lines">
        <div className="quote-line-header">
          <span>Description</span>
          <span>Quantity</span>
          <span>Total</span>
        </div>
        {invoice.lines.map((line) => (
          <div className="quote-line" key={line.id}>
            <div>
              <strong>{line.description}</strong>
              <small>{humanizeCommercialValue(line.lineType)}</small>
            </div>
            <span>
              {line.quantity
                ? `${line.quantity} ${humanizeCommercialValue(line.unit ?? "unit")}`
                : "—"}
            </span>
            <b>
              {line.direction === "credit" ? "−" : ""}
              {formatMoney(line.totalCents)}
            </b>
          </div>
        ))}
      </section>
      {invoice.adjustments.length > 0 && (
        <section className="public-invoice-adjustments">
          <span className="page-eyebrow">Posted adjustments</span>
          {invoice.adjustments.map((adjustment) => (
            <div key={adjustment.adjustmentNumber}>
              <span>{humanizeCommercialValue(adjustment.adjustmentType)}</span>
              <b>
                {adjustment.direction === "credit" ? "−" : "+"}
                {formatMoney(adjustment.amountCents)}
              </b>
            </div>
          ))}
        </section>
      )}
      <section className="public-quote-total">
        <div>
          <span>Subtotal</span>
          <b>{formatMoney(invoice.subtotalCents)}</b>
        </div>
        <div>
          <span>Tax</span>
          <b>{formatMoney(invoice.taxCents)}</b>
        </div>
        <div>
          <span>Applied payments and value</span>
          <b>−{formatMoney(invoice.appliedCents)}</b>
        </div>
        <div className="grand-total">
          <span>Amount due</span>
          <b>{formatMoney(invoice.outstandingBalanceCents)}</b>
        </div>
      </section>
      {invoice.outstandingBalanceCents === 0 && (
        <div className="public-invoice-paid">
          <CheckCircle2 size={22} />
          <div>
            <strong>Paid in full</strong>
            <span>No balance remains on this Invoice.</span>
          </div>
        </div>
      )}
      <footer className="public-invoice-security">
        <ShieldCheck size={18} />
        <span>
          This secure view contains customer-facing charges only. Internal costs, margin, approvals,
          and employee notes are never included.
        </span>
      </footer>
    </article>
  );
}
