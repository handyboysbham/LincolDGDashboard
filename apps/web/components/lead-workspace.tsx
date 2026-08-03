"use client";

import type { components } from "@ldg/api-client";
import {
  ArrowRight,
  ClipboardList,
  MapPin,
  PackageOpen,
  Plus,
  Search,
  TriangleAlert,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { type SyntheticEvent, useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";

type Lead = components["schemas"]["LeadDto"];

type LeadWorkspaceState =
  { name: "loading" } | { message: string; name: "error" } | { items: Lead[]; name: "ready" };

const statusFilters = ["", "new", "contacting", "qualified", "estimating", "lost"] as const;

export function LeadWorkspace() {
  const [state, setState] = useState<LeadWorkspaceState>({ name: "loading" });
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async (search: string, selectedStatus: string) => {
    setState({ name: "loading" });
    try {
      const response = await getApiClient().GET("/api/v1/leads", {
        params: {
          query: {
            limit: 100,
            ...(search ? { q: search } : {}),
            ...(selectedStatus ? { status: selectedStatus } : {}),
          },
        },
      });
      if (!response.data) throw new Error(apiErrorMessage(response.error));
      setState({ items: response.data.items, name: "ready" });
    } catch (error) {
      setState({ message: apiErrorMessage(error), name: "error" });
    }
  }, []);

  useEffect(() => {
    void load("", "");
  }, [load]);

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    void load(query.trim(), status);
  };

  return (
    <div className="intake-page lead-workspace">
      <section className="intake-page-heading">
        <div>
          <span className="page-eyebrow">Sales pipeline</span>
          <h1>Leads</h1>
          <p>Every request from first call through estimating readiness.</p>
        </div>
        <Link className="button button-primary" href="/leads/new">
          <Plus aria-hidden="true" size={17} /> New lead
        </Link>
      </section>

      <section className="panel intake-main-panel">
        <form className="lead-filter-bar" onSubmit={submit}>
          <label className="intake-search lead-search">
            <Search aria-hidden="true" size={18} />
            <span className="visually-hidden">Search leads</span>
            <input
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Search customer, number, or request"
              value={query}
            />
          </label>
          <label className="filter-select">
            <span>Status</span>
            <select
              onChange={(event) => {
                setStatus(event.target.value);
              }}
              value={status}
            >
              {statusFilters.map((value) => (
                <option key={value === "" ? "all" : value} value={value}>
                  {value ? humanStatus(value) : "All statuses"}
                </option>
              ))}
            </select>
          </label>
          <button className="button button-secondary" type="submit">
            Apply
          </button>
        </form>

        {state.name === "loading" && <LeadListSkeleton />}
        {state.name === "error" && (
          <div className="intake-state intake-state-error" role="alert">
            <TriangleAlert aria-hidden="true" size={24} />
            <h2>The Lead pipeline is unavailable</h2>
            <p>{state.message}</p>
            <button
              className="button button-secondary"
              onClick={() => void load(query, status)}
              type="button"
            >
              Try again
            </button>
          </div>
        )}
        {state.name === "ready" && state.items.length === 0 && (
          <div className="intake-state">
            <span className="intake-state-icon">
              <ClipboardList aria-hidden="true" size={25} />
            </span>
            <h2>{query || status ? "No Leads match these filters" : "No Leads yet"}</h2>
            <p>
              {query || status
                ? "Change the search or status to broaden the pipeline."
                : "Capture the first customer request to begin the operating timeline."}
            </p>
            {!query && !status && (
              <Link className="button button-primary" href="/leads/new">
                <Plus size={16} /> Create the first lead
              </Link>
            )}
          </div>
        )}
        {state.name === "ready" && state.items.length > 0 && (
          <div className="lead-list">
            <div className="lead-list-header" aria-hidden="true">
              <span>Opportunity</span>
              <span>Service</span>
              <span>Location</span>
              <span>Status</span>
              <span />
            </div>
            {state.items.map((lead) => (
              <Link className="lead-row" href={`/leads/${lead.id}`} key={lead.id}>
                <span className="lead-customer-cell">
                  <strong>{lead.customer.displayName}</strong>
                  <small>{lead.leadNumber}</small>
                </span>
                <span className="lead-service-cell">
                  <i className={`service-icon service-icon-${lead.serviceType}`}>
                    {lead.serviceType === "material_delivery" ? (
                      <Truck aria-hidden="true" size={16} />
                    ) : (
                      <PackageOpen aria-hidden="true" size={16} />
                    )}
                  </i>
                  {lead.serviceType === "material_delivery"
                    ? "Material delivery"
                    : "Trailer rental"}
                </span>
                <span className="lead-location-cell">
                  <MapPin aria-hidden="true" size={14} />
                  {lead.serviceLocation.city}, {lead.serviceLocation.region}
                </span>
                <span className={`lead-status lead-status-${lead.status}`}>
                  {humanStatus(lead.status)}
                </span>
                <ArrowRight aria-hidden="true" size={17} />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function LeadListSkeleton() {
  return (
    <div aria-label="Loading Leads" className="lead-list lead-list-skeleton" role="status">
      {[0, 1, 2, 3, 4].map((item) => (
        <div className="lead-row" key={item}>
          <span>
            <i className="skeleton skeleton-line" />
            <i className="skeleton skeleton-line short" />
          </span>
          <i className="skeleton skeleton-line" />
          <i className="skeleton skeleton-line" />
          <i className="skeleton skeleton-pill" />
        </div>
      ))}
    </div>
  );
}

function humanStatus(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}
