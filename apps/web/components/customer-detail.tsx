"use client";

import type { components } from "@ldg/api-client";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Mail,
  MapPin,
  Phone,
  Plus,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";
import { CustomerNotificationPreferences } from "./customer-notification-preferences";

type Customer = components["schemas"]["CustomerDetailDto"];

type CustomerDetailState =
  { name: "loading" } | { message: string; name: "error" } | { customer: Customer; name: "ready" };

export function CustomerDetail({ customerId }: { customerId: string }) {
  const [state, setState] = useState<CustomerDetailState>({ name: "loading" });

  const load = useCallback(async () => {
    try {
      const response = await getApiClient().GET("/api/v1/customers/{id}", {
        params: { path: { id: customerId } },
      });
      if (!response.data) throw new Error(apiErrorMessage(response.error));
      setState({ customer: response.data, name: "ready" });
    } catch (error) {
      setState({ message: apiErrorMessage(error), name: "error" });
    }
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.name === "loading") {
    return (
      <div aria-label="Loading customer" className="intake-page" role="status">
        <div className="skeleton skeleton-title" />
        <div className="skeleton detail-skeleton-card" />
      </div>
    );
  }
  if (state.name === "error") {
    return (
      <div className="intake-page">
        <div className="intake-state intake-state-error full-panel-state" role="alert">
          <AlertTriangle size={26} />
          <h1>Customer unavailable</h1>
          <p>{state.message}</p>
          <Link className="button button-secondary" href="/customers">
            Back to customers
          </Link>
        </div>
      </div>
    );
  }

  const { customer } = state;
  return (
    <div className="intake-page customer-detail-page">
      <section className="lead-detail-heading">
        <div>
          <Link className="back-link" href="/customers">
            <ArrowLeft size={15} /> Customers
          </Link>
          <span className="page-eyebrow">Customer account</span>
          <h1>{customer.displayName}</h1>
          <p>
            {customer.customerType === "business" ? "Business" : "Residential"} · {customer.status}
          </p>
        </div>
        <Link className="button button-primary" href="/leads/new">
          <Plus size={16} /> New Lead
        </Link>
      </section>

      <div className="customer-detail-grid">
        <div className="customer-detail-main">
          <section className="panel customer-leads-panel">
            <div className="panel-heading compact">
              <div>
                <span className="panel-kicker">Opportunities</span>
                <h2>Lead history</h2>
              </div>
              <span className="count-pill">{customer.leads.length}</span>
            </div>
            {customer.leads.length === 0 ? (
              <div className="intake-state compact-state">
                <h3>No Leads yet</h3>
                <p>Start an opportunity for this customer.</p>
              </div>
            ) : (
              <div className="customer-lead-history">
                {customer.leads.map((lead) => (
                  <Link href={`/leads/${lead.id}`} key={lead.id}>
                    <span className={`service-icon service-icon-${lead.serviceType}`}>
                      {lead.serviceType === "material_delivery" ? (
                        <Building2 size={16} />
                      ) : (
                        <MapPin size={16} />
                      )}
                    </span>
                    <span>
                      <strong>{lead.summary}</strong>
                      <small>
                        {lead.leadNumber} · {humanStatus(lead.serviceType)}
                      </small>
                    </span>
                    <span className={`lead-status lead-status-${lead.status}`}>
                      {humanStatus(lead.status)}
                    </span>
                    <ArrowRight size={16} />
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="panel customer-locations-panel">
            <div className="panel-heading compact">
              <div>
                <span className="panel-kicker">Service addresses</span>
                <h2>Locations</h2>
              </div>
              <MapPin size={19} />
            </div>
            <div className="location-card-grid">
              {customer.serviceLocations.map((location) => (
                <article key={location.id}>
                  <span>
                    <MapPin size={17} />
                  </span>
                  <div>
                    <strong>{location.label}</strong>
                    <p>
                      {location.addressLine1}
                      <br />
                      {location.city}, {location.region} {location.postalCode}
                    </p>
                    {location.accessNotes && <small>{location.accessNotes}</small>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <aside className="panel customer-contacts-panel">
          <div className="panel-heading compact">
            <div>
              <span className="panel-kicker">People</span>
              <h2>Contacts</h2>
            </div>
            <UserRound size={19} />
          </div>
          {customer.contacts.map((contact) => (
            <article className="customer-contact-card" key={contact.id}>
              <span className="customer-avatar">
                <UserRound size={18} />
              </span>
              <div>
                <strong>{contact.displayName}</strong>
                <small>Prefers {contact.preferredContactMethod}</small>
              </div>
              <p>
                {contact.phone && (
                  <span>
                    <Phone size={13} /> {contact.phone}
                  </span>
                )}
                {contact.email && (
                  <span>
                    <Mail size={13} /> {contact.email}
                  </span>
                )}
              </p>
            </article>
          ))}
        </aside>
      </div>
      <CustomerNotificationPreferences contacts={customer.contacts} customerId={customer.id} />
    </div>
  );
}

function humanStatus(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}
