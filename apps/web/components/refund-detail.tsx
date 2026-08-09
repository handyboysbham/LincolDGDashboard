"use client";

import type { components } from "@ldg/api-client";
import { AlertTriangle, ArrowLeft, CheckCircle2, RefreshCw, RotateCcw } from "lucide-react";
import Link from "next/link";
import { type SyntheticEvent, useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";
import { formatMoney, humanizeCommercialValue, shortDate } from "../lib/commercial-format";
import { formText, refundAction } from "../lib/finance-state";

type Refund = components["schemas"]["RefundDto"];
type State =
  { name: "loading" } | { message: string; name: "error" } | { name: "ready"; refund: Refund };

export function RefundDetail({ refundId }: { refundId: string }) {
  const [state, setState] = useState<State>({ name: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const load = useCallback(async () => {
    const response = await getApiClient().GET("/api/v1/refunds/{id}", {
      params: { path: { id: refundId } },
    });
    setState(
      response.data
        ? { name: "ready", refund: response.data }
        : { message: apiErrorMessage(response.error), name: "error" },
    );
  }, [refundId]);
  useEffect(() => void load(), [load]);
  const run = async (operation: () => Promise<{ data?: Refund; error?: unknown }>) => {
    setBusy(true);
    setActionError(undefined);
    try {
      const response = await operation();
      if (!response.data) throw new Error(apiErrorMessage(response.error));
      setState({ name: "ready", refund: response.data });
    } catch (error) {
      setActionError(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  if (state.name === "loading") return <RefundState label="Loading Refund…" />;
  if (state.name === "error")
    return <RefundState error={state.message} label="Refund unavailable" />;

  const { refund } = state;
  const nextAction = refundAction(refund.status);
  const approve = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const identityVerificationReference = formText(
      new FormData(event.currentTarget),
      "identityVerificationReference",
    );
    void run(() =>
      getApiClient().POST("/api/v1/refunds/{id}/actions/approve", {
        body: identityVerificationReference ? { identityVerificationReference } : {},
        params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: refundId } },
      }),
    );
  };
  const process = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const providerName = formText(form, "providerName");
    const providerRefundId = formText(form, "providerRefundId");
    void run(() =>
      getApiClient().POST("/api/v1/refunds/{id}/actions/process", {
        body: {
          ...(providerName ? { providerName } : {}),
          ...(providerRefundId ? { providerRefundId } : {}),
        },
        params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: refundId } },
      }),
    );
  };
  const reasonAction = (
    event: SyntheticEvent<HTMLFormElement>,
    action: "cancel" | "fail" | "reverse",
  ) => {
    event.preventDefault();
    const reason = formText(new FormData(event.currentTarget), "reason");
    const options = {
      body: { reason },
      params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: refundId } },
    } as const;
    if (action === "cancel")
      void run(() => getApiClient().POST("/api/v1/refunds/{id}/actions/cancel", options));
    else if (action === "fail")
      void run(() => getApiClient().POST("/api/v1/refunds/{id}/actions/fail", options));
    else void run(() => getApiClient().POST("/api/v1/refunds/{id}/actions/reverse", options));
  };

  return (
    <div className="intake-page billing-page">
      <section className="lead-detail-heading billing-detail-heading">
        <div>
          <Link className="back-link" href="/billing">
            <ArrowLeft size={15} /> Billing
          </Link>
          <span className="page-eyebrow">Customer Refund</span>
          <h1>{refund.refundNumber}</h1>
          <p>
            {humanizeCommercialValue(refund.sourceType)} ·{" "}
            {humanizeCommercialValue(refund.refundMethod)}
          </p>
        </div>
        <div className="commercial-action-row">
          <span className={`finance-status status-${refund.status}`}>
            {humanizeCommercialValue(refund.status)}
          </span>
          {nextAction === "settle" && (
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  getApiClient().POST("/api/v1/refunds/{id}/actions/settle", {
                    params: {
                      header: { "Idempotency-Key": crypto.randomUUID() },
                      path: { id: refundId },
                    },
                  }),
                )
              }
            >
              <CheckCircle2 size={16} /> Settle Refund
            </button>
          )}
        </div>
      </section>
      {actionError && (
        <div className="inline-form-error" role="alert">
          <AlertTriangle size={17} /> {actionError}
        </div>
      )}
      <section className="panel finance-summary-grid">
        <div>
          <span>Refund amount</span>
          <strong>{formatMoney(refund.amountCents)}</strong>
        </div>
        <div>
          <span>Method</span>
          <strong>{humanizeCommercialValue(refund.refundMethod)}</strong>
        </div>
        <div>
          <span>Approved</span>
          <strong>{shortDate(refund.approvedAt)}</strong>
        </div>
        <div>
          <span>Settled</span>
          <strong>{shortDate(refund.settledAt)}</strong>
        </div>
      </section>
      <div className="billing-detail-grid">
        <main className="operations-stack">
          <section className="panel operations-section">
            <span className="page-eyebrow">Attributable request</span>
            <h2>Refund reason</h2>
            <p>{refund.reason}</p>
            {refund.alternateMethodReason && (
              <div className="finance-review-note">
                <AlertTriangle size={18} />
                <div>
                  <strong>Alternate method review</strong>
                  <span>{refund.alternateMethodReason}</span>
                </div>
              </div>
            )}
          </section>
          <section className="panel operations-section">
            <span className="page-eyebrow">Value source</span>
            <h2>{humanizeCommercialValue(refund.sourceType)}</h2>
            <dl className="finance-definition-list">
              <div>
                <dt>Source ID</dt>
                <dd>
                  <code>{refund.sourceId}</code>
                </dd>
              </div>
              <div>
                <dt>Original method</dt>
                <dd>{humanizeCommercialValue(refund.originalMethod ?? "not recorded")}</dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd>{refund.providerName ?? "Not processed"}</dd>
              </div>
              <div>
                <dt>Provider reference</dt>
                <dd>{refund.providerRefundId ?? "—"}</dd>
              </div>
            </dl>
          </section>
        </main>
        <aside className="operations-stack">
          {nextAction === "approve" && (
            <section className="panel operations-section">
              <CheckCircle2 size={22} />
              <h2>Approve Refund</h2>
              <p>Alternate-method Refunds require an attributable identity check.</p>
              <form className="compact-form" onSubmit={approve}>
                <label>
                  Identity verification reference
                  <input
                    name="identityVerificationReference"
                    placeholder="Required for alternate method"
                  />
                </label>
                <button className="button button-primary" disabled={busy}>
                  Approve Refund
                </button>
              </form>
            </section>
          )}
          {nextAction === "process" && (
            <section className="panel operations-section">
              <RotateCcw size={22} />
              <h2>Record processing</h2>
              <form className="compact-form" onSubmit={process}>
                <label>
                  Provider name
                  <input name="providerName" />
                </label>
                <label>
                  Provider refund ID
                  <input name="providerRefundId" />
                </label>
                <button className="button button-primary" disabled={busy}>
                  Mark Processing
                </button>
              </form>
            </section>
          )}
          {nextAction === "reverse" && (
            <section className="panel operations-section danger-zone">
              <AlertTriangle size={22} />
              <h2>Reverse settled Refund</h2>
              <p>This creates an exact compensating row; the settled Refund remains unchanged.</p>
              <form
                className="compact-form"
                onSubmit={(event) => {
                  reasonAction(event, "reverse");
                }}
              >
                <label>
                  Reason
                  <textarea name="reason" required rows={3} />
                </label>
                <button className="button danger-button" disabled={busy}>
                  Create reversal
                </button>
              </form>
            </section>
          )}
          {["approved", "processing", "processed", "review_required", "pending_approval"].includes(
            refund.status,
          ) && (
            <section className="panel operations-section">
              <h2>Stop workflow</h2>
              <form
                className="compact-form"
                onSubmit={(event) => {
                  reasonAction(
                    event,
                    refund.status === "processing" || refund.status === "processed"
                      ? "fail"
                      : "cancel",
                  );
                }}
              >
                <label>
                  Reason
                  <textarea name="reason" required rows={2} />
                </label>
                <button className="button button-secondary" disabled={busy}>
                  {refund.status === "processing" || refund.status === "processed"
                    ? "Mark failed"
                    : "Cancel Refund"}
                </button>
              </form>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function RefundState({ error, label }: { error?: string; label: string }) {
  return (
    <div className="intake-page billing-page">
      <section className="panel commercial-loading" role={error ? "alert" : "status"}>
        {error ? <AlertTriangle size={22} /> : <RefreshCw className="spin" size={22} />}
        <div>
          <h1>{label}</h1>
          {error && <p>{error}</p>}
        </div>
        {error && (
          <Link className="button button-secondary" href="/billing">
            Back to Billing
          </Link>
        )}
      </section>
    </div>
  );
}
