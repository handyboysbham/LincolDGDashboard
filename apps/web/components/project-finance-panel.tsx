"use client";

import type { components } from "@ldg/api-client";
import { AlertTriangle, ArrowRight, Banknote, FileText, RefreshCw, Scale } from "lucide-react";
import Link from "next/link";
import { type SyntheticEvent, useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";
import { formatMoney, humanizeCommercialValue } from "../lib/commercial-format";
import { formText, parseMoneyInputToCents } from "../lib/finance-state";

type Invoice = components["schemas"]["InvoiceSummaryDto"];
type Payment = components["schemas"]["PaymentDto"];
type Deposit = components["schemas"]["DepositBalanceDto"];
type Credit = components["schemas"]["CustomerCreditDto"];
type Completion = components["schemas"]["FinancialCompletionDto"];
type Job = components["schemas"]["JobSummaryDto"];
type State =
  | { name: "loading" }
  | { message: string; name: "error" }
  | {
      credits: Credit[];
      deposits: Deposit[];
      invoices: Invoice[];
      name: "ready";
      payments: Payment[];
    };

export function ProjectFinancePanel({
  customerAccountId,
  jobs,
  projectId,
}: {
  customerAccountId: string;
  jobs: Job[];
  projectId: string;
}) {
  const [state, setState] = useState<State>({ name: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [completion, setCompletion] = useState<Completion>();
  const load = useCallback(async () => {
    const client = getApiClient();
    const [invoices, payments, deposits, credits] = await Promise.all([
      client.GET("/api/v1/invoices", { params: { query: { projectId } } }),
      client.GET("/api/v1/payments", { params: { query: { projectId } } }),
      client.GET("/api/v1/projects/{id}/deposit-balances", { params: { path: { id: projectId } } }),
      client.GET("/api/v1/customers/{id}/customer-credits", {
        params: { path: { id: customerAccountId } },
      }),
    ]);
    if (!invoices.data || !payments.data || !deposits.data || !credits.data) {
      setState({ message: "Project finance records could not be loaded.", name: "error" });
      return;
    }
    setState({
      credits: credits.data.items,
      deposits: deposits.data.items,
      invoices: invoices.data.items,
      name: "ready",
      payments: payments.data.items,
    });
  }, [customerAccountId, projectId]);
  useEffect(() => void load(), [load]);

  const createInvoice = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setActionError(undefined);
    const invoiceType = formText(form, "invoiceType") as
      "additional_charge" | "credit_memo" | "deposit" | "final";
    const jobId = formText(form, "jobId");
    const response = await getApiClient().POST("/api/v1/projects/{id}/invoices", {
      body: {
        dueInDays: Number(form.get("dueInDays") ?? 14),
        invoiceType,
        ...(jobId ? { jobId } : {}),
      },
      params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: projectId } },
    });
    if (!response.data) setActionError(apiErrorMessage(response.error));
    else await load();
    setBusy(false);
  };
  const createPayment = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amountCents = parseMoneyInputToCents(form.get("amount"));
    if (!amountCents) {
      setActionError("Enter a positive Payment amount with no more than two decimal places.");
      return;
    }
    setBusy(true);
    setActionError(undefined);
    const response = await getApiClient().POST("/api/v1/projects/{id}/payments", {
      body: {
        amountCents,
        currency: "USD",
        payerName: formText(form, "payerName"),
        paymentMethod: formText(form, "paymentMethod") as
          "bank_transfer" | "card" | "cash" | "cash_app" | "check" | "paypal" | "venmo" | "zelle",
        receivingAccountReference: formText(form, "receivingAccountReference"),
        receiptStatus: "attached",
      },
      params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: projectId } },
    });
    if (!response.data) setActionError(apiErrorMessage(response.error));
    else await load();
    setBusy(false);
  };
  const evaluate = async () => {
    setBusy(true);
    setActionError(undefined);
    const response = await getApiClient().POST(
      "/api/v1/projects/{id}/actions/evaluate-financial-completion",
      { params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: projectId } } },
    );
    if (!response.data) setActionError(apiErrorMessage(response.error));
    else setCompletion(response.data);
    setBusy(false);
  };

  return (
    <section className="panel operations-section project-finance-panel">
      <div className="billing-section-heading">
        <div>
          <span className="page-eyebrow">Authoritative ledger</span>
          <h2>Finance</h2>
        </div>
        <Link className="button button-secondary" href="/billing">
          Open Billing
        </Link>
      </div>
      {state.name === "loading" && (
        <div className="commercial-loading" role="status">
          <RefreshCw className="spin" size={18} /> Loading finance…
        </div>
      )}
      {state.name === "error" && (
        <div className="inline-form-error" role="alert">
          <AlertTriangle size={17} /> {state.message}
        </div>
      )}
      {actionError && (
        <div className="inline-form-error" role="alert">
          <AlertTriangle size={17} /> {actionError}
        </div>
      )}
      {state.name === "ready" && (
        <>
          <div className="project-finance-counts">
            <span>
              <FileText size={16} />
              <strong>{state.invoices.length}</strong> Invoices
            </span>
            <span>
              <Banknote size={16} />
              <strong>{state.payments.length}</strong> Payments
            </span>
            <span>
              <Scale size={16} />
              <strong>{state.deposits.length + state.credits.length}</strong> held-value records
            </span>
          </div>
          <div className="project-finance-records">
            {state.invoices.map((invoice) => (
              <Link href={`/billing/invoices/${invoice.id}`} key={invoice.id}>
                <div>
                  <strong>{invoice.invoiceNumber}</strong>
                  <small>
                    {humanizeCommercialValue(invoice.invoiceType)} ·{" "}
                    {humanizeCommercialValue(invoice.status)}
                  </small>
                </div>
                <b>{formatMoney(invoice.outstandingBalanceCents)} due</b>
                <ArrowRight size={15} />
              </Link>
            ))}
            {state.payments.map((payment) => (
              <Link href={`/billing/payments/${payment.id}`} key={payment.id}>
                <div>
                  <strong>{payment.paymentNumber}</strong>
                  <small>
                    {humanizeCommercialValue(payment.paymentMethod)} ·{" "}
                    {humanizeCommercialValue(payment.status)}
                  </small>
                </div>
                <b>{formatMoney(payment.availableCents)} available</b>
                <ArrowRight size={15} />
              </Link>
            ))}
          </div>
          <div className="project-finance-forms">
            <form className="compact-form" onSubmit={(event) => void createInvoice(event)}>
              <h3>Create Invoice</h3>
              <label>
                Type
                <select name="invoiceType">
                  <option value="deposit">Deposit</option>
                  <option value="final">Final</option>
                  <option value="additional_charge">Additional charge</option>
                  <option value="credit_memo">Credit memo</option>
                </select>
              </label>
              <label>
                Job
                <select name="jobId">
                  <option value="">Project level</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.jobNumber}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Due in days
                <input defaultValue="14" max="365" min="0" name="dueInDays" type="number" />
              </label>
              <button className="button button-primary" disabled={busy}>
                Create draft
              </button>
            </form>
            <form className="compact-form" onSubmit={(event) => void createPayment(event)}>
              <h3>Record Payment</h3>
              <label>
                Amount
                <input inputMode="decimal" name="amount" required />
              </label>
              <label>
                Method
                <select name="paymentMethod">
                  <option value="zelle">Zelle</option>
                  <option value="check">Check</option>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="bank_transfer">Bank transfer</option>
                </select>
              </label>
              <label>
                Payer name
                <input name="payerName" required />
              </label>
              <label>
                Company account reference
                <input name="receivingAccountReference" required />
              </label>
              <button className="button button-primary" disabled={busy}>
                Record Payment
              </button>
            </form>
          </div>
          <div className="financial-completion-card">
            <div>
              <Scale size={19} />
              <div>
                <strong>Financial completion</strong>
                <span>Derived only from posted obligations and unresolved customer value.</span>
              </div>
            </div>
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => void evaluate()}
              type="button"
            >
              Evaluate
            </button>
            {completion && (
              <div
                className={
                  completion.financiallyComplete
                    ? "completion-result is-complete"
                    : "completion-result"
                }
              >
                <strong>
                  {completion.financiallyComplete ? "Financially complete" : "Blocked"}
                </strong>
                <span>
                  {formatMoney(completion.outstandingInvoiceCents)} outstanding ·{" "}
                  {completion.blockers.length} blockers
                </span>
                {completion.blockers.map((blocker) => (
                  <small key={blocker}>{blocker}</small>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
