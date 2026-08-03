"use client";

import type { components } from "@ldg/api-client";
import { AlertTriangle, CalendarDays, Plus, RefreshCw, Truck } from "lucide-react";
import Link from "next/link";
import { type SyntheticEvent, useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";
import { humanizeCommercialValue, shortDate } from "../lib/commercial-format";

type Asset = components["schemas"]["AssetDto"];
type Block = components["schemas"]["ScheduleBlockDto"];
type Job = components["schemas"]["JobSummaryDto"];
type State =
  | { name: "loading" }
  | { message: string; name: "error" }
  | { assets: Asset[]; blocks: Block[]; jobs: Job[]; name: "ready"; userId: string };

export function ScheduleWorkspace() {
  const [state, setState] = useState<State>({ name: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const load = useCallback(async () => {
    setState({ name: "loading" });
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const to = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const [queue, assets, calendar, session] = await Promise.all([
      getApiClient().GET("/api/v1/schedule/queue"),
      getApiClient().GET("/api/v1/assets"),
      getApiClient().GET("/api/v1/schedule/calendar", { params: { query: { from, to } } }),
      getApiClient().GET("/api/v1/session"),
    ]);
    if (!queue.data) {
      setState(loadError(queue.error));
      return;
    }
    if (!assets.data) {
      setState(loadError(assets.error));
      return;
    }
    if (!calendar.data) {
      setState(loadError(calendar.error));
      return;
    }
    if (!session.data) {
      setState(loadError(session.error));
      return;
    }
    setState({
      assets: assets.data.items,
      blocks: calendar.data.items,
      jobs: queue.data.items,
      name: "ready",
      userId: session.data.userId,
    });
  }, []);
  useEffect(() => void load(), [load]);
  const createAsset = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setActionError(undefined);
    const response = await getApiClient().POST("/api/v1/assets", {
      body: {
        assetNumber: textValue(data, "assetNumber"),
        assetType: textValue(data, "assetType") as "equipment" | "trailer" | "truck",
        name: textValue(data, "name"),
      },
      params: { header: { "Idempotency-Key": crypto.randomUUID() } },
    });
    if (!response.data) setActionError(apiErrorMessage(response.error));
    else {
      event.currentTarget.reset();
      await load();
    }
    setBusy(false);
  };
  const createBlock = async (event: SyntheticEvent<HTMLFormElement>, jobId: string) => {
    event.preventDefault();
    if (state.name !== "ready") return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setActionError(undefined);
    const response = await getApiClient().POST("/api/v1/jobs/{id}/schedule-blocks", {
      body: {
        assetIds: [textValue(data, "assetId")],
        blockType: textValue(data, "blockType") as
          "disposal" | "dropoff" | "inspection" | "other" | "pickup" | "service",
        endsAt: new Date(textValue(data, "endsAt")).toISOString(),
        startsAt: new Date(textValue(data, "startsAt")).toISOString(),
        userIds: [state.userId],
      },
      params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: jobId } },
    });
    if (!response.data) setActionError(apiErrorMessage(response.error));
    else {
      event.currentTarget.reset();
      await load();
    }
    setBusy(false);
  };
  if (state.name === "loading")
    return (
      <div className="intake-page">
        <section className="panel commercial-loading">
          <RefreshCw className="spin" size={22} /> Loading schedule…
        </section>
      </div>
    );
  if (state.name === "error")
    return (
      <div className="intake-page">
        <section className="panel intake-state commercial-empty" role="alert">
          <AlertTriangle size={27} />
          <h1>Schedule unavailable</h1>
          <p>{state.message}</p>
          <button className="button button-secondary" onClick={() => void load()}>
            Try again
          </button>
        </section>
      </div>
    );
  return (
    <div className="intake-page operations-page">
      <section className="intake-page-heading">
        <div>
          <span className="page-eyebrow">Capacity and commitments</span>
          <h1>Schedule</h1>
          <p>
            Reserve people and equipment together. Overlapping active asset reservations are
            rejected transactionally.
          </p>
        </div>
        <Link className="button button-secondary" href="/jobs">
          Job queue
        </Link>
      </section>
      {actionError && (
        <div className="inline-form-error" role="alert">
          <AlertTriangle size={17} /> {actionError}
        </div>
      )}
      <div className="schedule-layout">
        <main className="operations-stack">
          <section className="panel operations-section">
            <div className="operations-section-heading">
              <div>
                <span className="page-eyebrow">Next 30 days</span>
                <h2>Calendar commitments</h2>
              </div>
              <CalendarDays size={20} />
            </div>
            {state.blocks.length === 0 ? (
              <div className="schedule-empty">
                <CalendarDays size={24} />
                <p>No blocks in this calendar window.</p>
              </div>
            ) : (
              <div className="calendar-grid">
                {state.blocks.map((block) => (
                  <Link className="calendar-card" href={`/jobs/${block.jobId}`} key={block.id}>
                    <span>{shortDate(block.startsAt)}</span>
                    <strong>{block.jobNumber}</strong>
                    <small>
                      {humanizeCommercialValue(block.blockType)} ·{" "}
                      {humanizeCommercialValue(block.status)}
                    </small>
                  </Link>
                ))}
              </div>
            )}
          </section>
          <section className="panel operations-section">
            <div className="operations-section-heading">
              <div>
                <span className="page-eyebrow">Readiness queue</span>
                <h2>Needs scheduling</h2>
              </div>
              <Truck size={20} />
            </div>
            {state.jobs.length === 0 ? (
              <div className="schedule-empty">
                <Truck size={24} />
                <p>No Jobs are waiting for scheduling.</p>
              </div>
            ) : (
              state.jobs.map((job) => (
                <article className="schedule-job-card" key={job.id}>
                  <div>
                    <strong>{job.jobNumber}</strong>
                    <span>
                      {job.customerName} · {humanizeCommercialValue(job.serviceType)}
                    </span>
                  </div>
                  {state.assets.length === 0 ? (
                    <p>Add an available asset before scheduling.</p>
                  ) : (
                    <form
                      className="schedule-form"
                      onSubmit={(event) => void createBlock(event, job.id)}
                    >
                      <label>
                        Block
                        <select
                          name="blockType"
                          defaultValue={
                            job.serviceType === "dump_trailer_rental" ? "dropoff" : "service"
                          }
                        >
                          <option value="service">Service</option>
                          <option value="dropoff">Dropoff</option>
                          <option value="pickup">Pickup</option>
                          <option value="disposal">Disposal</option>
                        </select>
                      </label>
                      <label>
                        Asset
                        <select name="assetId">
                          {state.assets
                            .filter((asset) => asset.status === "available")
                            .map((asset) => (
                              <option key={asset.id} value={asset.id}>
                                {asset.assetNumber} · {asset.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Start
                        <input name="startsAt" required type="datetime-local" />
                      </label>
                      <label>
                        End
                        <input name="endsAt" required type="datetime-local" />
                      </label>
                      <button className="button button-primary" disabled={busy}>
                        Reserve
                      </button>
                    </form>
                  )}
                  <Link className="back-link" href={`/jobs/${job.id}`}>
                    Review readiness and confirm schedule →
                  </Link>
                </article>
              ))
            )}
          </section>
        </main>
        <aside className="operations-stack">
          <section className="panel operations-section">
            <span className="page-eyebrow">Fleet registry</span>
            <h2>Assets</h2>
            {state.assets.map((asset) => (
              <div className="plain-list-row" key={asset.id}>
                <Truck size={16} />
                <span>
                  {asset.assetNumber} · {asset.name}
                </span>
                <small>{humanizeCommercialValue(asset.status)}</small>
              </div>
            ))}
            <form className="compact-form asset-form" onSubmit={(event) => void createAsset(event)}>
              <label>
                Asset number
                <input name="assetNumber" required />
              </label>
              <label>
                Name
                <input name="name" required />
              </label>
              <label>
                Type
                <select name="assetType">
                  <option value="truck">Truck</option>
                  <option value="trailer">Trailer</option>
                  <option value="equipment">Equipment</option>
                </select>
              </label>
              <button className="button button-secondary" disabled={busy}>
                <Plus size={16} /> Add asset
              </button>
            </form>
          </section>
        </aside>
      </div>
    </div>
  );
}

function loadError(error: unknown): State {
  return { message: apiErrorMessage(error), name: "error" };
}

function textValue(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}
