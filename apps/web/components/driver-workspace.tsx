"use client";

import type { components } from "@ldg/api-client";
import { AlertTriangle, ArrowRight, CheckCircle2, MapPinned, RefreshCw, Truck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";
import { humanizeCommercialValue, shortDate } from "../lib/commercial-format";

type Job = components["schemas"]["JobSummaryDto"];
type State =
  { name: "loading" } | { message: string; name: "error" } | { items: Job[]; name: "ready" };

export function DriverWorkspace({
  view = "home",
}: {
  view?: "home" | "jobs" | "route" | "schedule";
}) {
  const [state, setState] = useState<State>({ name: "loading" });
  const load = useCallback(async () => {
    setState({ name: "loading" });
    const response = await getApiClient().GET("/api/v1/jobs");
    if (!response.data) {
      setState({ message: apiErrorMessage(response.error), name: "error" });
      return;
    }
    const materialJobs = response.data.items.filter(
      (job) =>
        job.serviceType === "material_delivery" &&
        !["cancelled", "closed", "financially_complete"].includes(job.status),
    );
    const items =
      view === "home"
        ? materialJobs.filter((job) => ["dispatch_ready", "active"].includes(job.status))
        : view === "schedule"
          ? materialJobs.filter((job) =>
              ["needs_scheduling", "scheduled", "dispatch_ready"].includes(job.status),
            )
          : materialJobs;
    setState({ items, name: "ready" });
  }, [view]);
  useEffect(() => void load(), [load]);

  const copy = workspaceCopy(view);
  return (
    <main className="driver-main">
      <section className="driver-greeting">
        <span className="driver-avatar">AJ</span>
        <div>
          <span>{copy.eyebrow}</span>
          <h1>{copy.title}</h1>
        </div>
      </section>

      {state.name === "loading" && (
        <section className="driver-state-card" role="status">
          <RefreshCw className="spin" size={24} />
          <h2>Loading assignments…</h2>
          <p>Checking the authoritative dispatch queue.</p>
        </section>
      )}
      {state.name === "error" && (
        <section className="driver-state-card is-error" role="alert">
          <AlertTriangle size={27} />
          <h2>Assignments unavailable</h2>
          <p>{state.message}</p>
          <button className="driver-primary-button" onClick={() => void load()} type="button">
            Try again
          </button>
        </section>
      )}
      {state.name === "ready" && state.items.length === 0 && (
        <section className="driver-empty-card">
          <div className="driver-empty-art" aria-hidden="true">
            <span className="driver-horizon" />
            <span className="driver-road" />
            <Truck size={54} strokeWidth={1.4} />
            <CheckCircle2 className="driver-check" size={30} />
          </div>
          <span className="status-chip">
            <CheckCircle2 size={15} /> All caught up
          </span>
          <h2>Your road is clear.</h2>
          <p>Dispatch will post the next delivery here as soon as it is ready.</p>
        </section>
      )}
      {state.name === "ready" && state.items.length > 0 && (
        <section aria-label="Material delivery assignments" className="driver-assignment-list">
          {state.items.map((job, index) => (
            <Link className="driver-assignment-card" href={`/driver/jobs/${job.id}`} key={job.id}>
              <div className="driver-assignment-topline">
                <span>{index === 0 ? "Next assignment" : "Upcoming"}</span>
                <b className={`status-${job.status}`}>{humanizeCommercialValue(job.status)}</b>
              </div>
              <h2>{job.customerName}</h2>
              <p>
                <MapPinned size={16} /> {job.jobNumber} · {shortDate(job.scheduledStartAt)}
              </p>
              <div className="driver-assignment-footer">
                <span className={`readiness-pill is-${job.readiness}`}>
                  {humanizeCommercialValue(job.readiness)}
                </span>
                <strong>
                  Open delivery <ArrowRight size={18} />
                </strong>
              </div>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}

function workspaceCopy(view: "home" | "jobs" | "route" | "schedule") {
  if (view === "jobs") return { eyebrow: "All open work", title: "Delivery jobs" };
  if (view === "route") return { eyebrow: "Stops and placement", title: "Route queue" };
  if (view === "schedule") return { eyebrow: "Upcoming assignments", title: "Driver schedule" };
  return { eyebrow: "Good morning, Andre", title: "Today’s road" };
}
