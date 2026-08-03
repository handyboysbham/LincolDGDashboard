"use client";

import type { components } from "@ldg/api-client";
import { AlertTriangle, ArrowRight, RefreshCw, Truck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";
import { humanizeCommercialValue, shortDate } from "../lib/commercial-format";

type Job = components["schemas"]["JobSummaryDto"];
type State =
  { name: "loading" } | { message: string; name: "error" } | { items: Job[]; name: "ready" };

export function JobWorkspace() {
  const [state, setState] = useState<State>({ name: "loading" });
  const [filter, setFilter] = useState("");
  const load = useCallback(
    async (status = filter) => {
      setState({ name: "loading" });
      const response = await getApiClient().GET("/api/v1/jobs", {
        params: { query: status ? { status } : {} },
      });
      setState(
        response.data
          ? { items: response.data.items, name: "ready" }
          : { message: apiErrorMessage(response.error), name: "error" },
      );
    },
    [filter],
  );
  useEffect(() => void load(), [load]);
  return (
    <div className="intake-page operations-page">
      <section className="intake-page-heading">
        <div>
          <span className="page-eyebrow">Operations queue</span>
          <h1>Jobs</h1>
          <p>One independently scheduled trip or rental is one Job.</p>
        </div>
        <div className="commercial-action-row">
          <label className="inline-filter">
            Status
            <select
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
              }}
            >
              <option value="">All</option>
              <option value="needs_scheduling">Needs scheduling</option>
              <option value="scheduled">Scheduled</option>
              <option value="dispatch_ready">Dispatch ready</option>
              <option value="active">Active</option>
            </select>
          </label>
          <Link className="button button-primary" href="/schedule">
            Schedule board
          </Link>
        </div>
      </section>
      {state.name === "loading" && (
        <section className="panel commercial-loading" role="status">
          <RefreshCw className="spin" size={22} /> Loading Jobs…
        </section>
      )}
      {state.name === "error" && (
        <section className="panel intake-state commercial-empty" role="alert">
          <AlertTriangle size={27} />
          <h2>Jobs unavailable</h2>
          <p>{state.message}</p>
          <button className="button button-secondary" onClick={() => void load()}>
            Try again
          </button>
        </section>
      )}
      {state.name === "ready" && state.items.length === 0 && (
        <section className="panel intake-state commercial-empty">
          <Truck size={28} />
          <h2>No Jobs in this queue</h2>
          <p>Accepted Quotes create the first Job automatically.</p>
          <Link className="button button-primary" href="/projects">
            Open Projects
          </Link>
        </section>
      )}
      {state.name === "ready" && state.items.length > 0 && (
        <section className="panel operations-table">
          <div className="operations-table-header job-columns">
            <span>Job</span>
            <span>Project</span>
            <span>Schedule</span>
            <span>Readiness</span>
            <span>Status</span>
            <span />
          </div>
          {state.items.map((job) => (
            <Link
              className="operations-table-row job-columns"
              href={`/jobs/${job.id}`}
              key={job.id}
            >
              <div>
                <strong>{job.jobNumber}</strong>
                <small>
                  {job.customerName} · {humanizeCommercialValue(job.serviceType)}
                </small>
              </div>
              <span>{job.projectNumber}</span>
              <span>{shortDate(job.scheduledStartAt)}</span>
              <span className={`readiness-pill is-${job.readiness}`}>
                {humanizeCommercialValue(job.readiness)}
              </span>
              <b>{humanizeCommercialValue(job.status)}</b>
              <ArrowRight size={17} />
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
