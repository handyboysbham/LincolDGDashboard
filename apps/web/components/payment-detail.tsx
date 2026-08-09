"use client";

import type { components } from "@ldg/api-client";
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Coins,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";
import { type SyntheticEvent, useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";
import { formatMoney, humanizeCommercialValue, shortDate } from "../lib/commercial-format";
import { formText, parseMoneyInputToCents } from "../lib/finance-state";

type Payment = components["schemas"]["PaymentDto"];
type Invoice = components["schemas"]["InvoiceSummaryDto"];
type Deposit = components["schemas"]["DepositBalanceDto"];
type Credit = components["schemas"]["CustomerCreditDto"];
type State =
  | { name: "loading" }
  | { message: string; name: "error" }
  | {
      credits: Credit[];
      deposits: Deposit[];
      invoices: Invoice[];
      name: "ready";
      payment: Payment;
    };

export function PaymentDetail({ paymentId }: { paymentId: string }) {
  const [state, setState] = useState<State>({ name: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [createdRefundId, setCreatedRefundId] = useState<string>();
  const load = useCallback(async () => {
    try {
      const client = getApiClient();
      const paymentResponse = await client.GET("/api/v1/payments/{id}", {
        params: { path: { id: paymentId } },
      });
      if (!paymentResponse.data) throw new Error(apiErrorMessage(paymentResponse.error));
      const payment = paymentResponse.data;
      const [invoices, deposits, credits] = await Promise.all([
        payment.projectId
          ? client.GET("/api/v1/invoices", { params: { query: { projectId: payment.projectId } } })
          : Promise.resolve({ data: { items: [] as Invoice[] }, error: undefined }),
        payment.projectId
          ? client.GET("/api/v1/projects/{id}/deposit-balances", {
              params: { path: { id: payment.projectId } },
            })
          : Promise.resolve({ data: { items: [] as Deposit[] }, error: undefined }),
        client.GET("/api/v1/customers/{id}/customer-credits", {
          params: { path: { id: payment.customerAccountId } },
        }),
      ]);
      if (!invoices.data || !deposits.data || !credits.data) {
        throw new Error("Related Project finance records could not be loaded.");
      }
      setState({
        credits: credits.data.items,
        deposits: deposits.data.items,
        invoices: invoices.data.items,
        name: "ready",
        payment,
      });
    } catch (error) {
      setState({ message: apiErrorMessage(error), name: "error" });
    }
  }, [paymentId]);
  useEffect(() => void load(), [load]);

  const run = async (operation: () => Promise<{ data?: unknown; error?: unknown }>) => {
    setBusy(true);
    setActionError(undefined);
    try {
      const response = await operation();
      if (!response.data) throw new Error(apiErrorMessage(response.error));
      await load();
    } catch (error) {
      setActionError(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (state.name === "loading") return <FinanceLoading label="Loading Payment…" />;
  if (state.name === "error") return <FinanceError message={state.message} />;

  const { credits, deposits, invoices, payment } = state;
  const moneyFrom = (form: FormData, name = "amount") => {
    const amount = parseMoneyInputToCents(form.get(name));
    if (!amount) throw new Error("Enter a positive amount with no more than two decimal places.");
    return amount;
  };
  const transition = (action: "settle" | "verify") => {
    if (action === "verify") {
      void run(() =>
        getApiClient().POST("/api/v1/payments/{id}/actions/verify", {
          params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: paymentId } },
        }),
      );
    } else {
      void run(() =>
        getApiClient().POST("/api/v1/payments/{id}/actions/settle", {
          params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: paymentId } },
        }),
      );
    }
  };
  const allocate = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const amountCents = moneyFrom(form);
      void run(() =>
        getApiClient().POST("/api/v1/payments/{id}/allocations", {
          body: { amountCents, invoiceId: formText(form, "invoiceId") },
          params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: paymentId } },
        }),
      );
    } catch (error) {
      setActionError(apiErrorMessage(error));
    }
  };
  const createDeposit = (allocationId: string) => {
    void run(() =>
      getApiClient().POST("/api/v1/payment-allocations/{id}/actions/create-deposit-balance", {
        body: { depositType: "advance_payment" },
        params: {
          header: { "Idempotency-Key": crypto.randomUUID() },
          path: { id: allocationId },
        },
      }),
    );
  };
  const applySource = (
    event: SyntheticEvent<HTMLFormElement>,
    source: Deposit | Credit,
    kind: "credit" | "deposit",
  ) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const body = { amountCents: moneyFrom(form), invoiceId: formText(form, "invoiceId") };
      if (kind === "deposit")
        void run(() =>
          getApiClient().POST("/api/v1/deposit-balances/{id}/applications", {
            body,
            params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: source.id } },
          }),
        );
      else
        void run(() =>
          getApiClient().POST("/api/v1/customer-credits/{id}/applications", {
            body,
            params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: source.id } },
          }),
        );
    } catch (error) {
      setActionError(apiErrorMessage(error));
    }
  };
  const createRefund = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const [sourceType, sourceId] = formText(form, "source").split(":");
    try {
      const amountCents = moneyFrom(form);
      setBusy(true);
      setActionError(undefined);
      const refundMethod = formText(form, "refundMethod") as
        "bank_transfer" | "card" | "cash" | "cash_app" | "check" | "paypal" | "venmo" | "zelle";
      const originalMethod = sourceType === "payment" ? payment.paymentMethod : undefined;
      const response = await getApiClient().POST("/api/v1/customers/{id}/refunds", {
        body: {
          amountCents,
          ...(originalMethod && originalMethod !== refundMethod
            ? { alternateMethodReason: formText(form, "alternateMethodReason") }
            : {}),
          payeeName: formText(form, "payeeName"),
          reason: formText(form, "reason"),
          refundMethod,
          sourceId: sourceId ?? "",
          sourceType: sourceType as "customer_credit" | "deposit" | "payment",
        },
        params: {
          header: { "Idempotency-Key": crypto.randomUUID() },
          path: { id: payment.customerAccountId },
        },
      });
      if (!response.data) throw new Error(apiErrorMessage(response.error));
      setCreatedRefundId(response.data.id);
      await load();
    } catch (error) {
      setActionError(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const reversePayment = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = formText(new FormData(event.currentTarget), "reason");
    void run(() =>
      getApiClient().POST("/api/v1/payments/{id}/actions/reverse", {
        body: { reason },
        params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: paymentId } },
      }),
    );
  };

  const refundSources = [
    ...(payment.availableCents > 0
      ? [
          {
            id: payment.id,
            label: `${payment.paymentNumber} · ${formatMoney(payment.availableCents)}`,
            type: "payment",
          },
        ]
      : []),
    ...deposits
      .filter((item) => item.availableCents > 0)
      .map((item) => ({
        id: item.id,
        label: `Deposit · ${formatMoney(item.availableCents)}`,
        type: "deposit",
      })),
    ...credits
      .filter((item) => item.availableCents > 0)
      .map((item) => ({
        id: item.id,
        label: `${item.creditNumber} · ${formatMoney(item.availableCents)}`,
        type: "customer_credit",
      })),
  ];

  return (
    <div className="intake-page billing-page">
      <section className="lead-detail-heading billing-detail-heading">
        <div>
          <Link className="back-link" href="/billing">
            <ArrowLeft size={15} /> Billing
          </Link>
          <span className="page-eyebrow">Received Payment</span>
          <h1>{payment.paymentNumber}</h1>
          <p>
            {payment.customerName}
            {payment.projectNumber ? ` · ${payment.projectNumber}` : ""}
          </p>
        </div>
        <div className="commercial-action-row">
          <span className={`finance-status status-${payment.status}`}>
            {humanizeCommercialValue(payment.status)}
          </span>
          {payment.status === "verification_required" && (
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => {
                transition("verify");
              }}
            >
              <CheckCircle2 size={16} /> Verify
            </button>
          )}
          {payment.status === "verified" && (
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => {
                transition("settle");
              }}
            >
              <CheckCircle2 size={16} /> Settle
            </button>
          )}
        </div>
      </section>
      {actionError && (
        <div className="inline-form-error" role="alert">
          <AlertTriangle size={17} /> {actionError}
        </div>
      )}
      {createdRefundId && (
        <div className="secure-link-banner">
          <RotateCcw size={18} />
          <div>
            <strong>Refund workflow created</strong>
            <span>Review approval and processing evidence before settlement.</span>
          </div>
          <Link className="button button-secondary" href={`/billing/refunds/${createdRefundId}`}>
            Open Refund
          </Link>
        </div>
      )}
      <section className="panel finance-summary-grid">
        <div>
          <span>Received</span>
          <strong>{formatMoney(payment.amountCents)}</strong>
        </div>
        <div>
          <span>Allocated</span>
          <strong>{formatMoney(payment.allocatedCents)}</strong>
        </div>
        <div>
          <span>Refunded</span>
          <strong>{formatMoney(payment.refundedCents)}</strong>
        </div>
        <div>
          <span>Available</span>
          <strong>{formatMoney(payment.availableCents)}</strong>
        </div>
      </section>

      <div className="billing-detail-grid">
        <main className="operations-stack">
          <section className="panel operations-section">
            <div className="billing-section-heading">
              <div>
                <span className="page-eyebrow">Append-only ledger</span>
                <h2>Payment allocations</h2>
              </div>
              <span className="count-pill">{payment.allocations.length}</span>
            </div>
            {payment.allocations.map((entry) => {
              const target = invoices.find((invoice) => invoice.id === entry.invoiceId);
              const canCreateDeposit =
                entry.entryKind === "application" &&
                target?.invoiceType === "deposit" &&
                !deposits.some((deposit) => deposit.sourcePaymentAllocationId === entry.id) &&
                !payment.allocations.some(
                  (candidate) =>
                    candidate.entryKind === "reversal" &&
                    candidate.reversesApplicationId === entry.id,
                );
              return (
                <div className="finance-ledger-row" key={entry.id}>
                  <div>
                    <strong>{humanizeCommercialValue(entry.entryKind)}</strong>
                    <small>{target?.invoiceNumber ?? entry.invoiceId}</small>
                  </div>
                  <b>
                    {entry.entryKind === "reversal" ? "−" : "+"}
                    {formatMoney(entry.amountCents)}
                  </b>
                  <span>{shortDate(entry.appliedAt)}</span>
                  {canCreateDeposit && (
                    <button
                      className="button button-small"
                      disabled={busy}
                      onClick={() => {
                        createDeposit(entry.id);
                      }}
                      type="button"
                    >
                      Create Deposit
                    </button>
                  )}
                </div>
              );
            })}
            {["settled", "partially_allocated"].includes(payment.status) &&
              payment.availableCents > 0 &&
              invoices.length > 0 && (
                <form className="finance-inline-form" onSubmit={allocate}>
                  <label className="wide-field">
                    Invoice
                    <select name="invoiceId">
                      {invoices
                        .filter((item) => item.outstandingBalanceCents > 0)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.invoiceNumber} · {formatMoney(item.outstandingBalanceCents)} due
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Amount
                    <input inputMode="decimal" name="amount" placeholder="0.00" required />
                  </label>
                  <button className="button button-primary" disabled={busy}>
                    Apply Payment
                  </button>
                </form>
              )}
          </section>

          <section className="panel operations-section">
            <div className="billing-section-heading">
              <div>
                <span className="page-eyebrow">Held value</span>
                <h2>Deposits and credits</h2>
              </div>
              <Coins size={20} />
            </div>
            {deposits.map((deposit) => (
              <SourceCard
                invoices={invoices}
                key={deposit.id}
                label={humanizeCommercialValue(deposit.depositType)}
                onApply={(event) => {
                  applySource(event, deposit, "deposit");
                }}
                source={deposit}
              />
            ))}
            {credits.map((credit) => (
              <SourceCard
                invoices={invoices}
                key={credit.id}
                label={credit.creditNumber}
                onApply={(event) => {
                  applySource(event, credit, "credit");
                }}
                source={credit}
              />
            ))}
            {deposits.length === 0 && credits.length === 0 && (
              <p className="muted-copy">
                No Deposit Balances or Customer Credits are connected to this account.
              </p>
            )}
          </section>
        </main>

        <aside className="operations-stack">
          {refundSources.length > 0 && (
            <section className="panel operations-section">
              <RotateCcw size={22} />
              <h2>Create Refund</h2>
              <p>
                Original method is preferred. Alternate methods enter review and require identity
                evidence.
              </p>
              <form className="compact-form" onSubmit={(event) => void createRefund(event)}>
                <label>
                  Value source
                  <select name="source">
                    {refundSources.map((source) => (
                      <option
                        key={`${source.type}:${source.id}`}
                        value={`${source.type}:${source.id}`}
                      >
                        {source.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Amount
                  <input inputMode="decimal" name="amount" required />
                </label>
                <label>
                  Refund method
                  <select defaultValue={payment.paymentMethod} name="refundMethod">
                    <option value="zelle">Zelle</option>
                    <option value="cash">Cash</option>
                    <option value="check">Check</option>
                    <option value="card">Card</option>
                    <option value="bank_transfer">Bank transfer</option>
                    <option value="venmo">Venmo</option>
                    <option value="cash_app">Cash App</option>
                    <option value="paypal">PayPal</option>
                  </select>
                </label>
                <label>
                  Payee name
                  <input name="payeeName" required />
                </label>
                <label>
                  Reason
                  <textarea name="reason" required rows={3} />
                </label>
                <label>
                  Alternate-method reason
                  <textarea name="alternateMethodReason" rows={2} />
                </label>
                <button className="button button-primary" disabled={busy}>
                  Create Refund
                </button>
              </form>
            </section>
          )}
          {payment.availableCents > 0 &&
            ["settled", "partially_allocated"].includes(payment.status) && (
              <section className="panel operations-section">
                <Coins size={22} />
                <h2>Hold as Customer Credit</h2>
                <p>Convert all currently unapplied Payment value into an account Credit.</p>
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      getApiClient().POST("/api/v1/customers/{id}/customer-credits", {
                        body: { sourceId: payment.id, sourceType: "unapplied_payment" },
                        params: {
                          header: { "Idempotency-Key": crypto.randomUUID() },
                          path: { id: payment.customerAccountId },
                        },
                      }),
                    )
                  }
                >
                  Create Customer Credit
                </button>
              </section>
            )}
          {payment.status !== "reversed" && payment.settledAt && (
            <section className="panel operations-section danger-zone">
              <AlertTriangle size={22} />
              <h2>Reverse whole Payment</h2>
              <p>
                Every dependent allocation and application will receive an exact linked reversal.
              </p>
              <form className="compact-form" onSubmit={reversePayment}>
                <label>
                  Reason
                  <textarea name="reason" required rows={3} />
                </label>
                <button className="button danger-button" disabled={busy}>
                  Reverse Payment
                </button>
              </form>
            </section>
          )}
          <section className="panel operations-section">
            <Banknote size={22} />
            <h2>Receipt evidence</h2>
            <dl className="finance-definition-list">
              <div>
                <dt>Method</dt>
                <dd>{humanizeCommercialValue(payment.paymentMethod)}</dd>
              </div>
              <div>
                <dt>Received</dt>
                <dd>{shortDate(payment.receivedAt)}</dd>
              </div>
              <div>
                <dt>Receipt</dt>
                <dd>{humanizeCommercialValue(payment.receiptStatus)}</dd>
              </div>
              <div>
                <dt>Account</dt>
                <dd>{payment.receivingAccountReference}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}

function SourceCard({
  invoices,
  label,
  onApply,
  source,
}: {
  invoices: Invoice[];
  label: string;
  onApply: (event: SyntheticEvent<HTMLFormElement>) => void;
  source: Credit | Deposit;
}) {
  return (
    <article className="finance-source-card">
      <div>
        <strong>{label}</strong>
        <span className={`finance-status status-${source.status}`}>
          {humanizeCommercialValue(source.status)}
        </span>
      </div>
      <dl>
        <div>
          <dt>Original</dt>
          <dd>{formatMoney(source.originalAmountCents)}</dd>
        </div>
        <div>
          <dt>Applied</dt>
          <dd>{formatMoney(source.appliedCents)}</dd>
        </div>
        <div>
          <dt>Available</dt>
          <dd>{formatMoney(source.availableCents)}</dd>
        </div>
      </dl>
      {source.availableCents > 0 &&
        invoices.some((invoice) => invoice.outstandingBalanceCents > 0) && (
          <form className="finance-inline-form" onSubmit={onApply}>
            <label className="wide-field">
              Apply to
              <select name="invoiceId">
                {invoices
                  .filter((invoice) => invoice.outstandingBalanceCents > 0)
                  .map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {invoice.invoiceNumber} · {formatMoney(invoice.outstandingBalanceCents)} due
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Amount
              <input inputMode="decimal" name="amount" required />
            </label>
            <button className="button button-secondary">Apply value</button>
          </form>
        )}
    </article>
  );
}

function FinanceLoading({ label }: { label: string }) {
  return (
    <div className="intake-page billing-page">
      <section className="panel commercial-loading" role="status">
        <RefreshCw className="spin" size={22} /> {label}
      </section>
    </div>
  );
}
function FinanceError({ message }: { message: string }) {
  return (
    <div className="intake-page billing-page">
      <section className="panel intake-state commercial-empty" role="alert">
        <AlertTriangle size={28} />
        <h1>Payment unavailable</h1>
        <p>{message}</p>
        <Link className="button button-secondary" href="/billing">
          Back to Billing
        </Link>
      </section>
    </div>
  );
}
