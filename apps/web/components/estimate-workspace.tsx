"use client";

import type { components } from "@ldg/api-client";
import { AlertTriangle, ArrowRight, Calculator, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";
import { formatMoney, humanizeCommercialValue } from "../lib/commercial-format";

type Estimate = components["schemas"]["EstimateListItemDto"];
type State =
  { name: "loading" } | { message: string; name: "error" } | { items: Estimate[]; name: "ready" };

export function EstimateWorkspace() {
  const [state, setState] = useState<State>({ name: "loading" });
  const load = useCallback(async () => {
    setState({ name: "loading" });
    const response = await getApiClient().GET("/api/v1/estimates");
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
          <span className="page-eyebrow">Internal pricing work</span>
          <h1>Estimates</h1>
          <p>Review server-calculated costs, readiness, and approval decisions.</p>
        </div>
        <Link className="button button-secondary" href="/pricing">
          Pricing setup
        </Link>
      </section>
      {state.name === "loading" && (
        <section className="panel commercial-loading" role="status">
          <RefreshCw className="spin" size={22} /> Loading Estimates…
        </section>
      )}
      {state.name === "error" && (
        <section className="panel intake-state commercial-empty" role="alert">
          <AlertTriangle size={27} />
          <h2>Estimates unavailable</h2>
          <p>{state.message}</p>
          <button className="button button-secondary" onClick={() => void load()}>
            Try again
          </button>
        </section>
      )}
      {state.name === "ready" && state.items.length === 0 && (
        <section className="panel intake-state commercial-empty">
          <Calculator size={28} />
          <h2>No Estimates yet</h2>
          <p>
            Move a qualified Lead to Estimating, then build its first pricing version from the Lead
            workspace.
          </p>
          <Link className="button button-primary" href="/leads">
            Open Leads
          </Link>
        </section>
      )}
      {state.name === "ready" && state.items.length > 0 && (
        <section className="panel commercial-record-panel">
          <div className="commercial-list-header">
            <span>Estimate</span>
            <span>Service</span>
            <span>Price</span>
            <span>Status</span>
            <span />
          </div>
          {state.items.map((estimate) => (
            <Link
              className="commercial-list-row"
              href={`/estimates/${estimate.estimateVersionId}`}
              key={estimate.estimateId}
            >
              <div>
                <strong>{estimate.customerName}</strong>
                <small>
                  {estimate.estimateNumber} · v{estimate.versionNumber}
                </small>
              </div>
              <span>{humanizeCommercialValue(estimate.serviceType)}</span>
              <b>{formatMoney(estimate.recommendedPriceCents)}</b>
              <i className={`commercial-status status-${estimate.status}`}>
                {humanizeCommercialValue(estimate.status)}
              </i>
              <ArrowRight size={17} />
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
