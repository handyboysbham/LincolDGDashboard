"use client";

import type { components } from "@ldg/api-client";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CircleDollarSign,
  FileText,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";
import { formatMoney, humanizeCommercialValue, shortDate } from "../lib/commercial-format";

type Invoice = components["schemas"]["InvoiceSummaryDto"];
type Payment = components["schemas"]["PaymentDto"];
type Refund = components["schemas"]["RefundDto"];
type State =
  | { name: "loading" }
  | { message: string; name: "error" }
  | { invoices: Invoice[]; name: "ready"; payments: Payment[]; refunds: Refund[] };

export function BillingWorkspace() {
  const [state, setState] = useState<State>({ name: "loading" });
  const load = useCallback(async () => {
    setState({ name: "loading" });
    try {
      const client = getApiClient();
      const [invoices, payments, refunds] = await Promise.all([
        client.GET("/api/v1/invoices"),
        client.GET("/api/v1/payments"),
        client.GET("/api/v1/refunds"),
      ]);
      if (!invoices.data || !payments.data || !refunds.data) {
        throw new Error("One or more Finance queues could not be loaded.");
      }
      setState({
        invoices: invoices.data.items,
        name: "ready",
        payments: payments.data.items,
        refunds: refunds.data.items,
      });
    } catch (error) {
      setState({ message: apiErrorMessage(error), name: "error" });
    }
  }, []);
  useEffect(() => void load(), [load]);

  if (state.name === "loading") {
    return (
      <div className="intake-page billing-page">
        <section className="panel commercial-loading" role="status">
          <RefreshCw className="spin" size={22} /> Loading billing…
        </section>
      </div>
    );
  }
  if (state.name === "error") {
    return (
      <div className="intake-page billing-page">
        <section className="panel intake-state commercial-empty" role="alert">
          <AlertTriangle size={28} />
          <h1>Billing is unavailable</h1>
          <p>{state.message}</p>
          <button className="button button-secondary" onClick={() => void load()} type="button">
            Try again
          </button>
        </section>
      </div>
    );
  }

  const activeRefunds = state.refunds.filter((refund) =>
    ["approved", "pending_approval", "processed", "processing", "review_required"].includes(
      refund.status,
    ),
  );
  return (
    <div className="intake-page billing-page">
      <section className="intake-page-heading">
        <div>
          <span className="page-eyebrow">Customer money</span>
          <h1>Billing</h1>
          <p>Post obligations, apply received value, and resolve every credit or refund.</p>
        </div>
        <Link className="button button-primary" href="/projects">
          Open a Project
        </Link>
      </section>

      <section aria-label="Finance queue summary" className="billing-metrics">
        <article>
          <FileText size={18} />
          <span>Invoices</span>
          <strong>{state.invoices.length}</strong>
          <small>Draft through paid</small>
        </article>
        <article>
          <Banknote size={18} />
          <span>Payments</span>
          <strong>{state.payments.length}</strong>
          <small>Received value records</small>
        </article>
        <article>
          <RotateCcw size={18} />
          <span>Refund actions</span>
          <strong>{activeRefunds.length}</strong>
          <small>Review or processing</small>
        </article>
      </section>

      <div className="billing-board">
        <section className="panel billing-queue billing-invoice-queue">
          <div className="billing-section-heading">
            <div>
              <span className="page-eyebrow">Obligations</span>
              <h2>Invoices</h2>
            </div>
            <span className="count-pill">{state.invoices.length}</span>
          </div>
          {state.invoices.length === 0 ? (
            <BillingEmpty icon={FileText} label="No Invoices yet" />
          ) : (
            <div className="billing-list">
              {state.invoices.map((invoice) => (
                <Link href={`/billing/invoices/${invoice.id}`} key={invoice.id}>
                  <span className="billing-record-icon">
                    <FileText size={17} />
                  </span>
                  <span className="billing-record-copy">
                    <strong>{invoice.invoiceNumber}</strong>
                    <small>
                      {invoice.customerName} · {invoice.projectNumber}
                    </small>
                  </span>
                  <span className="billing-money">
                    <strong>{formatMoney(invoice.outstandingBalanceCents)}</strong>
                    <small>due {shortDate(invoice.dueDate)}</small>
                  </span>
                  <span className={`finance-status status-${invoice.status}`}>
                    {humanizeCommercialValue(invoice.status)}
                  </span>
                  <ArrowRight size={16} />
                </Link>
              ))}
            </div>
          )}
        </section>

        <div className="billing-side-queues">
          <section className="panel billing-queue">
            <div className="billing-section-heading">
              <div>
                <span className="page-eyebrow">Received</span>
                <h2>Payments</h2>
              </div>
              <span className="count-pill">{state.payments.length}</span>
            </div>
            {state.payments.length === 0 ? (
              <BillingEmpty icon={Banknote} label="No Payments yet" />
            ) : (
              <div className="billing-list compact">
                {state.payments.map((payment) => (
                  <Link href={`/billing/payments/${payment.id}`} key={payment.id}>
                    <span className="billing-record-icon">
                      <CircleDollarSign size={17} />
                    </span>
                    <span className="billing-record-copy">
                      <strong>{payment.paymentNumber}</strong>
                      <small>{payment.customerName}</small>
                    </span>
                    <span className="billing-money">
                      <strong>{formatMoney(payment.amountCents)}</strong>
                      <small>{humanizeCommercialValue(payment.status)}</small>
                    </span>
                    <ArrowRight size={16} />
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="panel billing-queue">
            <div className="billing-section-heading">
              <div>
                <span className="page-eyebrow">Return value</span>
                <h2>Refunds</h2>
              </div>
              <span className="count-pill">{state.refunds.length}</span>
            </div>
            {state.refunds.length === 0 ? (
              <BillingEmpty icon={RotateCcw} label="No Refunds yet" />
            ) : (
              <div className="billing-list compact">
                {state.refunds.map((refund) => (
                  <Link href={`/billing/refunds/${refund.id}`} key={refund.id}>
                    <span className="billing-record-icon">
                      <RotateCcw size={17} />
                    </span>
                    <span className="billing-record-copy">
                      <strong>{refund.refundNumber}</strong>
                      <small>{humanizeCommercialValue(refund.sourceType)}</small>
                    </span>
                    <span className="billing-money">
                      <strong>{formatMoney(refund.amountCents)}</strong>
                      <small>{humanizeCommercialValue(refund.status)}</small>
                    </span>
                    <ArrowRight size={16} />
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function BillingEmpty({ icon: Icon, label }: { icon: typeof FileText; label: string }) {
  return (
    <div className="billing-empty">
      <Icon size={22} />
      <strong>{label}</strong>
      <span>Create the first record from a Project.</span>
    </div>
  );
}
