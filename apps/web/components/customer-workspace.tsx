"use client";

import type { components } from "@ldg/api-client";
import {
  ArrowRight,
  Building2,
  MapPin,
  Plus,
  Search,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { type SyntheticEvent, useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";

type Customer = components["schemas"]["CustomerAccountDto"];
type Lead = components["schemas"]["LeadDto"];

type WorkspaceState =
  | { name: "loading" }
  | { message: string; name: "error" }
  | { customers: Customer[]; leads: Lead[]; name: "ready"; total: number };

export function CustomerWorkspace() {
  const [state, setState] = useState<WorkspaceState>({ name: "loading" });
  const [query, setQuery] = useState("");

  const load = useCallback(async (search: string) => {
    setState({ name: "loading" });
    try {
      const client = getApiClient();
      const [customers, leads] = await Promise.all([
        client.GET("/api/v1/customers", {
          params: { query: { limit: 50, ...(search ? { q: search } : {}) } },
        }),
        client.GET("/api/v1/leads", { params: { query: { limit: 8 } } }),
      ]);
      if (!customers.data) throw new Error(apiErrorMessage(customers.error));
      if (!leads.data) throw new Error(apiErrorMessage(leads.error));
      setState({
        customers: customers.data.items,
        leads: leads.data.items,
        name: "ready",
        total: customers.data.total,
      });
    } catch (error) {
      setState({ message: apiErrorMessage(error), name: "error" });
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  const submitSearch = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    void load(query.trim());
  };

  return (
    <div className="intake-page customer-workspace">
      <section className="intake-page-heading">
        <div>
          <span className="page-eyebrow">Customer intake</span>
          <h1>Customers</h1>
          <p>Accounts, contacts, service locations, and every opportunity in one place.</p>
        </div>
        <Link className="button button-primary" href="/leads/new">
          <Plus aria-hidden="true" size={17} /> New lead
        </Link>
      </section>

      <div className="intake-layout">
        <section className="panel intake-main-panel">
          <div className="intake-toolbar">
            <form className="intake-search" onSubmit={submitSearch} role="search">
              <Search aria-hidden="true" size={18} />
              <label className="visually-hidden" htmlFor="customer-search">
                Search customers
              </label>
              <input
                id="customer-search"
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                placeholder="Search by customer name"
                value={query}
              />
              <button type="submit">Search</button>
            </form>
            {state.name === "ready" && (
              <span className="result-count">
                {state.total} {state.total === 1 ? "account" : "accounts"}
              </span>
            )}
          </div>

          {state.name === "loading" && <CustomerListSkeleton />}
          {state.name === "error" && (
            <div className="intake-state intake-state-error" role="alert">
              <TriangleAlert aria-hidden="true" size={24} />
              <h2>Customer records are unavailable</h2>
              <p>{state.message}</p>
              <button
                className="button button-secondary"
                onClick={() => void load(query)}
                type="button"
              >
                Try again
              </button>
            </div>
          )}
          {state.name === "ready" && state.customers.length === 0 && (
            <div className="intake-state">
              <span className="intake-state-icon">
                <UserRound aria-hidden="true" size={25} />
              </span>
              <h2>{query ? "No matching customers" : "Your customer book starts here"}</h2>
              <p>
                {query
                  ? "Try a different name or clear the search."
                  : "Creating the first Lead will also create its customer, contact, and service location."}
              </p>
              {!query && (
                <Link className="button button-primary" href="/leads/new">
                  <Plus size={16} /> Create the first lead
                </Link>
              )}
            </div>
          )}
          {state.name === "ready" && state.customers.length > 0 && (
            <div className="customer-list">
              {state.customers.map((customer) => (
                <Link className="customer-row" href={`/customers/${customer.id}`} key={customer.id}>
                  <span className="customer-avatar">
                    {customer.customerType === "business" ? (
                      <Building2 aria-hidden="true" size={19} />
                    ) : (
                      <UserRound aria-hidden="true" size={19} />
                    )}
                  </span>
                  <span className="customer-row-copy">
                    <strong>{customer.displayName}</strong>
                    <span>
                      {customer.customerType === "business" ? "Business" : "Residential"} account
                    </span>
                  </span>
                  <span className="customer-status">{customer.status}</span>
                  <ArrowRight aria-hidden="true" size={17} />
                </Link>
              ))}
            </div>
          )}
        </section>

        <aside className="panel recent-leads-panel">
          <div className="panel-heading compact">
            <div>
              <span className="panel-kicker">Pipeline</span>
              <h2>Recent leads</h2>
            </div>
            <Link className="text-button" href="/leads">
              All leads <ArrowRight size={15} />
            </Link>
          </div>
          {state.name === "ready" && state.leads.length === 0 ? (
            <p className="quiet-panel-copy">New opportunities will appear here after intake.</p>
          ) : null}
          {state.name === "ready" && state.leads.length > 0 ? (
            <div className="recent-lead-list">
              {state.leads.map((lead) => (
                <Link href={`/leads/${lead.id}`} key={lead.id}>
                  <span className={`service-dot service-dot-${lead.serviceType}`} />
                  <span>
                    <strong>{lead.customer.displayName}</strong>
                    <small>
                      <MapPin size={12} /> {lead.serviceLocation.city},{" "}
                      {lead.serviceLocation.region}
                    </small>
                  </span>
                  <em>{humanStatus(lead.status)}</em>
                </Link>
              ))}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function CustomerListSkeleton() {
  return (
    <div aria-label="Loading customers" className="customer-list" role="status">
      {[0, 1, 2, 3].map((item) => (
        <div className="customer-row customer-row-skeleton" key={item}>
          <span className="skeleton customer-avatar" />
          <span className="customer-row-copy">
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-line short" />
          </span>
        </div>
      ))}
    </div>
  );
}

function humanStatus(value: string): string {
  return value.replaceAll("_", " ");
}
