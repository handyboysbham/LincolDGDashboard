"use client";

import type { components } from "@ldg/api-client";
import {
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileText,
  LoaderCircle,
  Mail,
  MapPin,
  Receipt,
  RotateCcw,
  ShieldCheck,
  Truck,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { apiErrorCode, apiErrorMessage, getApiClient } from "../lib/api-client";
import { formatMoney, humanizeCommercialValue, shortDate } from "../lib/commercial-format";
import { publicProjectFailure, type PublicProjectFailure } from "../lib/public-project-state";

type Project = components["schemas"]["PublicProjectDto"];
type State =
  | { name: "loading" }
  | { failure: PublicProjectFailure; message: string; name: "failure" }
  | { name: "ready"; project: Project };

export function PublicProjectCard({ token }: { token: string }) {
  const [state, setState] = useState<State>({ name: "loading" });

  useEffect(() => {
    let active = true;
    void getApiClient()
      .GET("/api/v1/public/projects/{token}", {
        params: { path: { token } },
        referrerPolicy: "no-referrer",
      })
      .then((response) => {
        if (!active) return;
        if (response.data) setState({ name: "ready", project: response.data });
        else
          setState({
            failure: publicProjectFailure(apiErrorCode(response.error)),
            message: apiErrorMessage(response.error),
            name: "failure",
          });
      })
      .catch((error: unknown) => {
        if (active)
          setState({ failure: "unavailable", message: apiErrorMessage(error), name: "failure" });
      });
    return () => {
      active = false;
    };
  }, [token]);

  if (state.name === "loading") {
    return (
      <div aria-live="polite" className="customer-state-card">
        <span className="customer-state-icon">
          <LoaderCircle className="spin" />
        </span>
        <span className="page-eyebrow">Secure project</span>
        <h1>Loading your Project…</h1>
        <p>We’re verifying your private link and preparing the latest customer-safe update.</p>
      </div>
    );
  }
  if (state.name === "failure")
    return <ProjectFailure failure={state.failure} message={state.message} />;

  const { project } = state;
  return (
    <article className="customer-project-card">
      <header className="customer-project-heading">
        <div>
          <span className="page-eyebrow">Project {project.projectNumber}</span>
          <h1>{project.outcomeStatement}</h1>
          <p>{humanizeCommercialValue(project.serviceType)}</p>
        </div>
        <span className={`customer-project-status status-${project.status}`}>
          <CheckCircle2 aria-hidden="true" size={16} /> {humanizeCommercialValue(project.status)}
        </span>
      </header>

      <section className="customer-project-facts" aria-label="Project contact and location">
        <div>
          <MapPin aria-hidden="true" size={18} />
          <span>
            <strong>{project.location.label}</strong>
            <small>
              {project.location.addressLine1}
              {project.location.addressLine2 ? `, ${project.location.addressLine2}` : ""}
              <br />
              {project.location.city}, {project.location.region} {project.location.postalCode}
            </small>
          </span>
        </div>
        <div>
          <Mail aria-hidden="true" size={18} />
          <span>
            <strong>{project.contact.displayName}</strong>
            <small>{project.contact.email ?? "Email not provided"}</small>
          </span>
        </div>
      </section>

      <div className="customer-project-grid">
        <section className="customer-project-section">
          <div className="customer-project-section-heading">
            <CalendarDays aria-hidden="true" size={18} />
            <div>
              <span>What’s next</span>
              <h2>Schedule</h2>
            </div>
          </div>
          {project.schedule.length === 0 ? (
            <CustomerEmpty
              icon={Clock3}
              copy="We’ll show confirmed service times here."
              title="Schedule being prepared"
            />
          ) : (
            <div className="customer-schedule-list">
              {project.schedule.map((item) => (
                <article key={item.jobNumber}>
                  <Truck aria-hidden="true" size={18} />
                  <div>
                    <strong>{humanizeCommercialValue(item.serviceType)}</strong>
                    <small>
                      {shortDateTime(item.scheduledStartAt)}
                      {item.scheduledEndAt ? ` – ${shortTime(item.scheduledEndAt)}` : ""}
                    </small>
                  </div>
                  <span>{humanizeCommercialValue(item.status)}</span>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="customer-project-section">
          <div className="customer-project-section-heading">
            <CheckCircle2 aria-hidden="true" size={18} />
            <div>
              <span>Progress</span>
              <h2>Milestones</h2>
            </div>
          </div>
          {project.milestones.length === 0 ? (
            <CustomerEmpty
              icon={Clock3}
              copy="Progress updates will appear after work begins."
              title="No milestones yet"
            />
          ) : (
            <ol className="customer-milestone-list">
              {project.milestones.map((milestone, index) => (
                <li key={`${milestone.type}-${milestone.occurredAt}`}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{milestone.label}</strong>
                    <small>{shortDate(milestone.occurredAt)}</small>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className="customer-project-section customer-finance-section">
        <div className="customer-project-section-heading">
          <WalletCards aria-hidden="true" size={18} />
          <div>
            <span>Account</span>
            <h2>Invoices and receipts</h2>
          </div>
        </div>
        {project.invoices.length + project.payments.length + project.refunds.length === 0 ? (
          <CustomerEmpty
            icon={Receipt}
            copy="Posted Invoices and settled transactions will appear here."
            title="No financial records yet"
          />
        ) : (
          <div className="customer-finance-grid">
            {project.invoices.map((invoice) => (
              <article key={invoice.invoiceNumber}>
                <Receipt size={18} />
                <div>
                  <strong>Invoice {invoice.invoiceNumber}</strong>
                  <small>
                    {shortDate(invoice.issueDate)} · {humanizeCommercialValue(invoice.status)}
                  </small>
                </div>
                <b>{invoice.totalCents === null ? "Pending" : formatMoney(invoice.totalCents)}</b>
                {invoice.customerPath ? (
                  <Link href={invoice.customerPath}>Open Invoice</Link>
                ) : (
                  <span>Secure link unavailable</span>
                )}
              </article>
            ))}
            {project.payments.map((payment) => (
              <article key={payment.paymentNumber}>
                <CheckCircle2 size={18} />
                <div>
                  <strong>Receipt {payment.paymentNumber}</strong>
                  <small>Received {shortDate(payment.receivedAt)}</small>
                </div>
                <b>{formatMoney(payment.amountCents)}</b>
                <span>{humanizeCommercialValue(payment.status)}</span>
              </article>
            ))}
            {project.refunds.map((refund) => (
              <article key={refund.refundNumber}>
                <RotateCcw size={18} />
                <div>
                  <strong>Refund {refund.refundNumber}</strong>
                  <small>
                    {refund.settledAt
                      ? `Settled ${shortDate(refund.settledAt)}`
                      : humanizeCommercialValue(refund.status)}
                  </small>
                </div>
                <b>{formatMoney(refund.amountCents)}</b>
                <span>{humanizeCommercialValue(refund.status)}</span>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="customer-project-section customer-documents-section">
        <div className="customer-project-section-heading">
          <FileText aria-hidden="true" size={18} />
          <div>
            <span>Shared files</span>
            <h2>Documents</h2>
          </div>
        </div>
        {project.documents.length === 0 ? (
          <CustomerEmpty
            icon={FileText}
            copy="Files intentionally shared with you will appear here."
            title="No shared Documents"
          />
        ) : (
          <div className="customer-document-list">
            {project.documents.map((document) => (
              <Link href={document.customerPath} key={`${document.purpose}-${document.filename}`}>
                <FileText aria-hidden="true" size={18} />
                <span>
                  <strong>{document.filename}</strong>
                  <small>{humanizeCommercialValue(document.purpose)}</small>
                </span>
                <b>Open</b>
              </Link>
            ))}
          </div>
        )}
      </section>

      <footer className="customer-project-security">
        <ShieldCheck aria-hidden="true" size={18} />
        <span>
          <strong>Your secure Project view</strong>
          <small>
            This page contains customer-facing records only. Your private link expires and can be
            revoked.
          </small>
        </span>
      </footer>
    </article>
  );
}

function ProjectFailure({ failure, message }: { failure: PublicProjectFailure; message: string }) {
  const content =
    failure === "expired"
      ? ["This Project link has expired.", "Ask Lincoln Dirt & Gravel for a current secure link."]
      : failure === "revoked"
        ? [
            "This Project link is no longer active.",
            "Contact us if you still need access to your Project.",
          ]
        : failure === "invalid"
          ? [
              "We can’t verify this Project link.",
              "Check that the complete link was copied from your message.",
            ]
          : ["Your Project is temporarily unavailable.", message];
  return (
    <div className="customer-state-card">
      <span className="customer-state-icon is-error">
        <CircleAlert />
      </span>
      <span className="page-eyebrow">Project unavailable</span>
      <h1>{content[0]}</h1>
      <p>{content[1]}</p>
    </div>
  );
}

function CustomerEmpty({
  icon: Icon,
  title,
  copy,
}: {
  icon: typeof Clock3;
  title: string;
  copy: string;
}) {
  return (
    <div className="customer-project-empty">
      <Icon aria-hidden="true" size={20} />
      <div>
        <strong>{title}</strong>
        <small>{copy}</small>
      </div>
    </div>
  );
}

function shortDateTime(value: string | null): string {
  if (!value) return "Time to be confirmed";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function shortTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(new Date(value));
}
