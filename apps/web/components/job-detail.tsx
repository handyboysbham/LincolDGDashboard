"use client";

import type { components } from "@ldg/api-client";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  MapPin,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { type SyntheticEvent, useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";
import { humanizeCommercialValue, shortDate } from "../lib/commercial-format";

type Job = components["schemas"]["JobDetailDto"];
type State = { name: "loading" } | { message: string; name: "error" } | { job: Job; name: "ready" };

export function JobDetail({ jobId }: { jobId: string }) {
  const [state, setState] = useState<State>({ name: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const load = useCallback(async () => {
    const response = await getApiClient().GET("/api/v1/jobs/{id}", {
      params: { path: { id: jobId } },
    });
    setState(
      response.data
        ? { job: response.data, name: "ready" }
        : { message: apiErrorMessage(response.error), name: "error" },
    );
  }, [jobId]);
  useEffect(() => void load(), [load]);
  const transition = async (
    action:
      | "await-final-invoice"
      | "close"
      | "complete-financially"
      | "complete-operationally"
      | "confirm-schedule"
      | "mark-dispatch-ready"
      | "mark-invoiced"
      | "request-scheduling"
      | "start"
      | "start-planning",
  ) => {
    setBusy(true);
    setActionError(undefined);
    const response = await getApiClient().POST("/api/v1/jobs/{id}/actions/{action}", {
      body: {},
      params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { action, id: jobId } },
    });
    if (!response.data) setActionError(apiErrorMessage(response.error));
    else setState({ job: response.data, name: "ready" });
    setBusy(false);
  };
  const evaluate = async () => {
    setBusy(true);
    const response = await getApiClient().POST("/api/v1/jobs/{id}/actions/evaluate-readiness", {
      body: { readinessType: "dispatch" },
      params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: jobId } },
    });
    if (!response.data) setActionError(apiErrorMessage(response.error));
    else await load();
    setBusy(false);
  };
  const createStop = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const label = textValue(data, "label");
    const sequence = state.name === "ready" ? state.job.routeStops.length + 1 : 1;
    setBusy(true);
    const response = await getApiClient().POST("/api/v1/jobs/{id}/route-stops", {
      body: { label, locationSnapshot: { label }, sequence, stopType: "customer" },
      params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: jobId } },
    });
    if (!response.data) setActionError(apiErrorMessage(response.error));
    else {
      event.currentTarget.reset();
      await load();
    }
    setBusy(false);
  };
  const createChecklist = async () => {
    setBusy(true);
    const response = await getApiClient().POST("/api/v1/jobs/{id}/checklists", {
      body: {
        items: [
          { label: "Confirm site access" },
          { label: "Verify assigned equipment" },
          { label: "Capture completion evidence" },
        ],
        name: "Shared operations checklist",
        templateCode: `shared-${crypto.randomUUID()}`,
      },
      params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: jobId } },
    });
    if (!response.data) setActionError(apiErrorMessage(response.error));
    else await load();
    setBusy(false);
  };
  const completeItem = async (id: string) => {
    setBusy(true);
    const response = await getApiClient().POST("/api/v1/checklist-items/{id}/actions/complete", {
      body: {},
      params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id } },
    });
    if (!response.data) setActionError(apiErrorMessage(response.error));
    else await load();
    setBusy(false);
  };
  if (state.name === "loading")
    return (
      <div className="intake-page">
        <section className="panel commercial-loading">
          <RefreshCw className="spin" size={22} /> Loading Job…
        </section>
      </div>
    );
  if (state.name === "error")
    return (
      <div className="intake-page">
        <section className="panel intake-state commercial-empty" role="alert">
          <AlertTriangle size={27} />
          <h1>Job unavailable</h1>
          <p>{state.message}</p>
          <Link className="button button-secondary" href="/jobs">
            Back to Jobs
          </Link>
        </section>
      </div>
    );
  const { job } = state;
  const next: Record<string, Parameters<typeof transition>[0]> = {
    active: "complete-operationally",
    awaiting_final_invoice: "mark-invoiced",
    dispatch_ready: "start",
    financially_complete: "close",
    invoiced: "complete-financially",
    needs_scheduling: "confirm-schedule",
    new: "start-planning",
    operationally_complete: "await-final-invoice",
    planning: "request-scheduling",
    scheduled: "mark-dispatch-ready",
  };
  const nextAction = next[job.status];
  return (
    <div className="intake-page operations-page">
      <section className="lead-detail-heading">
        <div>
          <Link className="back-link" href="/jobs">
            <ArrowLeft size={15} /> Jobs
          </Link>
          <span className="page-eyebrow">{job.jobNumber}</span>
          <h1>{job.customerName}</h1>
          <p>
            {job.projectNumber} · {humanizeCommercialValue(job.serviceType)}
          </p>
        </div>
        <div className="commercial-action-row">
          <span className={`readiness-pill is-${job.readiness}`}>
            {humanizeCommercialValue(job.readiness)}
          </span>
          <span className={`commercial-status status-${job.status}`}>
            {humanizeCommercialValue(job.status)}
          </span>
          {nextAction && (
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => void transition(nextAction)}
            >
              <CheckCircle2 size={16} /> {humanizeCommercialValue(nextAction)}
            </button>
          )}
        </div>
      </section>
      {actionError && (
        <div className="inline-form-error" role="alert">
          <AlertTriangle size={17} /> {actionError}
        </div>
      )}
      <div className="operations-detail-grid">
        <main className="operations-stack">
          <section className="panel operations-section">
            <div className="operations-section-heading">
              <div>
                <span className="page-eyebrow">Calendar commitments</span>
                <h2>Schedule Blocks</h2>
              </div>
              <Link className="button button-secondary" href="/schedule">
                Open board
              </Link>
            </div>
            {job.scheduleBlocks.length === 0 ? (
              <p className="muted-copy">No schedule blocks yet.</p>
            ) : (
              job.scheduleBlocks.map((block) => (
                <div className="schedule-block-card" key={block.id}>
                  <strong>{humanizeCommercialValue(block.blockType)}</strong>
                  <span>
                    {shortDate(block.startsAt)} · {block.assetIds.length} assets ·{" "}
                    {block.userIds.length} staff
                  </span>
                  <b>{humanizeCommercialValue(block.status)}</b>
                </div>
              ))
            )}
          </section>
          <section className="panel operations-section">
            <div className="operations-section-heading">
              <div>
                <span className="page-eyebrow">Shared execution</span>
                <h2>Route Stops</h2>
              </div>
              <MapPin size={20} />
            </div>
            {job.routeStops.map((stop) => (
              <div className="plain-list-row" key={stop.id}>
                <b>{stop.sequence}</b>
                <span>{stop.label}</span>
                <small>{humanizeCommercialValue(stop.stopType)}</small>
              </div>
            ))}
            <form className="inline-entry-form" onSubmit={(event) => void createStop(event)}>
              <label>
                <span className="visually-hidden">New route stop label</span>
                <input name="label" placeholder="Add customer or supplier stop" required />
              </label>
              <button className="button button-secondary" disabled={busy}>
                Add stop
              </button>
            </form>
          </section>
          <section className="panel operations-section">
            <div className="operations-section-heading">
              <div>
                <span className="page-eyebrow">Readiness evidence</span>
                <h2>Checklists</h2>
              </div>
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() => void createChecklist()}
              >
                <ClipboardCheck size={16} /> Add checklist
              </button>
            </div>
            {job.checklists.length === 0 ? (
              <p className="muted-copy">No shared checklist configured.</p>
            ) : (
              job.checklists.map((checklist) => (
                <article className="checklist-card" key={checklist.id}>
                  <strong>{checklist.name}</strong>
                  {checklist.items.map((item) => (
                    <button
                      className={
                        item.status === "completed" ? "checklist-item is-done" : "checklist-item"
                      }
                      disabled={busy || item.status === "completed"}
                      key={item.id}
                      onClick={() => void completeItem(item.id)}
                    >
                      <CheckCircle2 size={16} />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </article>
              ))
            )}
          </section>
        </main>
        <aside className="operations-stack">
          <section className="panel operations-section">
            <h2>Readiness</h2>
            <p>
              Re-evaluate contract, deposit, schedule, driver, asset, and checklist gates from
              authoritative records.
            </p>
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => void evaluate()}
            >
              Evaluate dispatch readiness
            </button>
          </section>
          <section className="panel operations-section">
            <span className="page-eyebrow">Immutable timeline</span>
            <h2>Job Events</h2>
            <div className="timeline-list">
              {job.events.map((event) => (
                <div key={event.id}>
                  <span />
                  <div>
                    <strong>{event.summary}</strong>
                    <small>{shortDate(event.occurredAt)}</small>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function textValue(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}
