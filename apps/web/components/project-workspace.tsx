"use client";

import type { components } from "@ldg/api-client";
import { AlertTriangle, ArrowRight, FolderKanban, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";
import { formatMoney, humanizeCommercialValue } from "../lib/commercial-format";

type Project = components["schemas"]["ProjectSummaryDto"];
type State =
  { name: "loading" } | { message: string; name: "error" } | { items: Project[]; name: "ready" };

export function ProjectWorkspace() {
  const [state, setState] = useState<State>({ name: "loading" });
  const load = useCallback(async () => {
    setState({ name: "loading" });
    const response = await getApiClient().GET("/api/v1/projects");
    setState(
      response.data
        ? { items: response.data.items, name: "ready" }
        : { message: apiErrorMessage(response.error), name: "error" },
    );
  }, []);
  useEffect(() => void load(), [load]);
  return (
    <div className="intake-page operations-page">
      <section className="intake-page-heading">
        <div>
          <span className="page-eyebrow">Accepted work</span>
          <h1>Projects</h1>
          <p>Move accepted work through contract, deposit, planning, and completion readiness.</p>
        </div>
        <Link className="button button-secondary" href="/jobs">
          Open Job queue
        </Link>
      </section>
      {state.name === "loading" && (
        <section className="panel commercial-loading" role="status">
          <RefreshCw className="spin" size={22} /> Loading Projects…
        </section>
      )}
      {state.name === "error" && (
        <section className="panel intake-state commercial-empty" role="alert">
          <AlertTriangle size={27} />
          <h2>Projects unavailable</h2>
          <p>{state.message}</p>
          <button className="button button-secondary" onClick={() => void load()}>
            Try again
          </button>
        </section>
      )}
      {state.name === "ready" && state.items.length === 0 && (
        <section className="panel intake-state commercial-empty">
          <FolderKanban size={28} />
          <h2>No Projects yet</h2>
          <p>A Project and its first Job appear here when a customer accepts a Quote.</p>
          <Link className="button button-primary" href="/quotes">
            Open Quotes
          </Link>
        </section>
      )}
      {state.name === "ready" && state.items.length > 0 && (
        <section className="panel operations-table">
          <div className="operations-table-header">
            <span>Project</span>
            <span>Value</span>
            <span>Contract</span>
            <span>Deposit</span>
            <span>Status</span>
            <span />
          </div>
          {state.items.map((project) => (
            <Link
              className="operations-table-row"
              href={`/projects/${project.id}`}
              key={project.id}
            >
              <div>
                <strong>{project.customerName}</strong>
                <small>
                  {project.projectNumber} · {humanizeCommercialValue(project.serviceType)}
                </small>
              </div>
              <b>{formatMoney(project.acceptedValueCents)}</b>
              <span className={`readiness-pill is-${project.contractStatus}`}>
                {humanizeCommercialValue(project.contractStatus)}
              </span>
              <span className={`readiness-pill is-${project.depositStatus}`}>
                {humanizeCommercialValue(project.depositStatus)}
              </span>
              <span>{humanizeCommercialValue(project.status)}</span>
              <ArrowRight size={17} />
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
