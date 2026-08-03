"use client";

import type { components } from "@ldg/api-client";
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  CheckCircle2,
  FilePlus2,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";
import { formatMoney, humanizeCommercialValue, shortDate } from "../lib/commercial-format";

type Estimate = components["schemas"]["EstimateVersionDto"];
type EstimateInput = components["schemas"]["CreateEstimateVersionDto"];
type State =
  { name: "loading" } | { message: string; name: "error" } | { estimate: Estimate; name: "ready" };

export function EstimateDetail({ estimateVersionId }: { estimateVersionId: string }) {
  const [state, setState] = useState<State>({ name: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();

  const load = useCallback(async () => {
    const response = await getApiClient().GET("/api/v1/estimate-versions/{id}", {
      params: { path: { id: estimateVersionId } },
    });
    if (!response.data) setState({ message: apiErrorMessage(response.error), name: "error" });
    else setState({ estimate: response.data, name: "ready" });
  }, [estimateVersionId]);
  useEffect(() => {
    void load();
  }, [load]);

  const command = async (path: "approve" | "create-quote" | "submit") => {
    if (state.name !== "ready") return;
    setBusy(true);
    setActionError(undefined);
    const params = {
      header: { "Idempotency-Key": crypto.randomUUID() },
      path: { id: state.estimate.id },
    };
    try {
      if (path === "submit") {
        const response = await getApiClient().POST(
          "/api/v1/estimate-versions/{id}/actions/submit",
          { params },
        );
        if (!response.data) throw new Error(apiErrorMessage(response.error));
        setState({ estimate: response.data, name: "ready" });
      } else if (path === "approve") {
        const response = await getApiClient().POST(
          "/api/v1/estimate-versions/{id}/actions/approve",
          { params },
        );
        if (!response.data) throw new Error(apiErrorMessage(response.error));
        setState({ estimate: response.data, name: "ready" });
      } else {
        const response = await getApiClient().POST(
          "/api/v1/estimate-versions/{id}/actions/create-quote",
          { params },
        );
        if (!response.data) throw new Error(apiErrorMessage(response.error));
        window.location.assign(`/quotes/${response.data.quoteId}`);
      }
    } catch (error) {
      setActionError(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const revise = async () => {
    if (state.name !== "ready") return;
    setBusy(true);
    setActionError(undefined);
    try {
      const response = await getApiClient().POST("/api/v1/estimates/{id}/actions/revise", {
        body: revisionInput(state.estimate),
        params: {
          header: { "Idempotency-Key": crypto.randomUUID() },
          path: { id: state.estimate.estimateId },
        },
      });
      if (!response.data) throw new Error(apiErrorMessage(response.error));
      window.location.assign(`/estimates/${response.data.id}`);
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
          <RefreshCw className="spin" size={22} /> Loading Estimate…
        </section>
      </div>
    );
  if (state.name === "error")
    return (
      <div className="intake-page">
        <section className="panel intake-state commercial-empty" role="alert">
          <AlertTriangle size={27} />
          <h1>Estimate unavailable</h1>
          <p>{state.message}</p>
          <Link className="button button-secondary" href="/estimates">
            Back to Estimates
          </Link>
        </section>
      </div>
    );

  const { estimate } = state;
  return (
    <div className="intake-page commercial-page">
      <section className="lead-detail-heading">
        <div>
          <Link className="back-link" href="/estimates">
            <ArrowLeft size={15} /> Estimates
          </Link>
          <span className="page-eyebrow">
            {estimate.estimateNumber} · version {estimate.versionNumber}
          </span>
          <h1>{estimate.customerName}</h1>
          <p>
            {humanizeCommercialValue(estimate.serviceType)} · Lead {estimate.leadNumber}
          </p>
        </div>
        <div className="commercial-action-row">
          <span className={`commercial-status status-${estimate.status}`}>
            {humanizeCommercialValue(estimate.status)}
          </span>
          {estimate.status === "draft" && (
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => void command("submit")}
            >
              <Calculator size={16} /> Submit for approval
            </button>
          )}
          {estimate.status === "pending_approval" && (
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => void command("approve")}
            >
              <CheckCircle2 size={16} /> Approve Estimate
            </button>
          )}
          {estimate.status === "approved" && (
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => void command("create-quote")}
            >
              <FilePlus2 size={16} /> Create Quote
            </button>
          )}
          {["approved", "quote_generated"].includes(estimate.status) && (
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => void revise()}
            >
              <RotateCcw size={16} /> Revise
            </button>
          )}
        </div>
      </section>
      {actionError && (
        <div className="inline-form-error" role="alert">
          <AlertTriangle size={17} /> {actionError}
        </div>
      )}
      <div className="commercial-detail-grid">
        <main className="commercial-side-stack">
          <section className="panel commercial-summary-panel">
            <div className="panel-heading compact">
              <div>
                <span className="panel-kicker">Server calculation</span>
                <h2>Pricing result</h2>
              </div>
              <span className="server-owned-note">Authoritative</span>
            </div>
            <div className="money-summary-grid">
              <div>
                <span>Purchase cost</span>
                <strong>{formatMoney(estimate.purchaseCostCents)}</strong>
              </div>
              <div>
                <span>Recommended price</span>
                <strong>{formatMoney(estimate.recommendedPriceCents)}</strong>
              </div>
              <div>
                <span>Required deposit</span>
                <strong>{formatMoney(estimate.depositCents)}</strong>
              </div>
              <div>
                <span>Estimated margin</span>
                <strong>{formatMoney(estimate.marginCents)}</strong>
              </div>
            </div>
          </section>
          <section className="panel commercial-record-panel">
            <div className="panel-heading compact">
              <div>
                <span className="panel-kicker">Calculation trail</span>
                <h2>Rule results</h2>
              </div>
              <span className="count-pill">{estimate.calculations.length}</span>
            </div>
            {estimate.calculations.map((calculation) => (
              <article className="amount-row" key={calculation.id}>
                <div>
                  <strong>{calculation.label}</strong>
                  <span>{humanizeCommercialValue(calculation.calculationType)}</span>
                </div>
                <b>{formatMoney(calculation.amountCents)}</b>
              </article>
            ))}
          </section>
          {estimate.costItems.length > 0 && (
            <section className="panel commercial-record-panel">
              <div className="panel-heading compact">
                <div>
                  <span className="panel-kicker">Internal only</span>
                  <h2>Supplier cost items</h2>
                </div>
              </div>
              {estimate.costItems.map((item) => (
                <article className="amount-row" key={item.id}>
                  <div>
                    <strong>{item.description}</strong>
                    <span>
                      {item.quantity} {humanizeCommercialValue(item.unit)} ×{" "}
                      {formatMoney(item.unitCostCents)}
                    </span>
                  </div>
                  <b>{formatMoney(item.totalCostCents)}</b>
                </article>
              ))}
            </section>
          )}
        </main>
        <aside className="commercial-side-stack">
          <section className="panel commercial-summary-panel">
            <div className="panel-heading compact">
              <div>
                <span className="panel-kicker">Pricing basis</span>
                <h2>{estimate.pricingPolicyName}</h2>
              </div>
            </div>
            <dl className="commercial-definition-list">
              <div>
                <dt>Pricing Version</dt>
                <dd>{estimate.pricingVersionNumber}</dd>
              </div>
              <div>
                <dt>Readiness</dt>
                <dd>{humanizeCommercialValue(estimate.readiness)}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{shortDate(estimate.createdAt)}</dd>
              </div>
              <div>
                <dt>Content hash</dt>
                <dd className="hash-value">{estimate.contentHash}</dd>
              </div>
            </dl>
          </section>
          <section className="panel commercial-summary-panel">
            <div className="panel-heading compact">
              <div>
                <span className="panel-kicker">Internal assessment</span>
                <h2>Operations and risk</h2>
              </div>
            </div>
            <div className="assessment-copy">
              <strong>Operational</strong>
              <p>{estimate.operationalAssessment ?? "No operational assessment recorded."}</p>
              <strong>Risk</strong>
              <p>{estimate.riskAssessment ?? "No risk assessment recorded."}</p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function revisionInput(estimate: Estimate): EstimateInput {
  const request = objectValue(objectValue(estimate.inputSnapshot, "request"), "materialDelivery");
  const materialDelivery =
    request && Array.isArray(request.items) && typeof request.deliveryZoneId === "string"
      ? {
          additionalSupplierStops: integerValue(request.additionalSupplierStops),
          deliveryZoneId: request.deliveryZoneId,
          items: request.items.flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const value = item as Record<string, unknown>;
            return typeof value.quantity === "string" &&
              typeof value.supplierCostVersionId === "string"
              ? [{ quantity: value.quantity, supplierCostVersionId: value.supplierCostVersionId }]
              : [];
          }),
          separatePlacements: integerValue(request.separatePlacements),
        }
      : undefined;
  return {
    ...(materialDelivery ? { materialDelivery } : {}),
    ...(estimate.operationalAssessment
      ? { operationalAssessment: estimate.operationalAssessment }
      : {}),
    pricingVersionId: estimate.pricingVersionId,
    ...(estimate.riskAssessment ? { riskAssessment: estimate.riskAssessment } : {}),
  };
}

function objectValue(
  source: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const value = source?.[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function integerValue(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}
