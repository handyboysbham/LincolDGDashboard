"use client";

import type { components } from "@ldg/api-client";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  FileText,
  Mail,
  MapPin,
  MessageSquareText,
  PackageOpen,
  Phone,
  Plus,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { type SyntheticEvent, useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";
import {
  humanizeIntakeValue,
  isLeadIntakeAction,
  isTerminalLeadStatus,
  leadTimelineLabel,
  nextLeadAction,
  type LeadIntakeAction,
} from "../lib/intake-state";
import { DocumentUploadCard } from "./document-upload-card";
import { EstimateBuilder } from "./estimate-builder";

type Lead = components["schemas"]["LeadDetailDto"];

type DetailState =
  { name: "loading" } | { message: string; name: "error" } | { lead: Lead; name: "ready" };

const terminalActions = [
  ["mark-lost", "Lost"],
  ["cancel", "Cancelled"],
  ["mark-duplicate", "Duplicate"],
  ["disqualify", "Disqualified"],
] as const;

export function LeadDetail({ leadId }: { leadId: string }) {
  const [state, setState] = useState<DetailState>({ name: "loading" });
  const [actionError, setActionError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await getApiClient().GET("/api/v1/leads/{id}", {
        params: { path: { id: leadId } },
      });
      if (!response.data) throw new Error(apiErrorMessage(response.error));
      setState({ lead: response.data, name: "ready" });
    } catch (error) {
      setState({ message: apiErrorMessage(error), name: "error" });
    }
  }, [leadId]);

  useEffect(() => {
    void load();
  }, [load]);

  const transition = async (action: LeadIntakeAction, reason?: string) => {
    setBusy(true);
    setActionError(undefined);
    try {
      const response = await getApiClient().POST("/api/v1/leads/{id}/actions/{action}", {
        body: { ...(reason ? { reason } : {}) },
        params: {
          header: { "Idempotency-Key": crypto.randomUUID() },
          path: { action, id: leadId },
        },
      });
      if (!response.data) throw new Error(apiErrorMessage(response.error));
      setState({ lead: response.data, name: "ready" });
    } catch (error) {
      setActionError(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const addNote = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form).get("body");
    if (typeof body !== "string" || !body.trim()) return;
    setBusy(true);
    const response = await getApiClient().POST("/api/v1/leads/{id}/notes", {
      body: { body: body.trim(), visibility: "internal" },
      params: {
        header: { "Idempotency-Key": crypto.randomUUID() },
        path: { id: leadId },
      },
    });
    setBusy(false);
    if (!response.data) {
      setActionError(apiErrorMessage(response.error));
      return;
    }
    form.reset();
    await load();
  };

  const addTask = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = data.get("title");
    const dueAt = data.get("dueAt");
    if (typeof title !== "string" || !title.trim()) return;
    setBusy(true);
    const response = await getApiClient().POST("/api/v1/leads/{id}/tasks", {
      body: {
        ...(typeof dueAt === "string" && dueAt
          ? { dueAt: new Date(`${dueAt}T17:00:00`).toISOString() }
          : {}),
        title: title.trim(),
      },
      params: {
        header: { "Idempotency-Key": crypto.randomUUID() },
        path: { id: leadId },
      },
    });
    setBusy(false);
    if (!response.data) {
      setActionError(apiErrorMessage(response.error));
      return;
    }
    form.reset();
    await load();
  };

  const completeTask = async (taskId: string) => {
    setBusy(true);
    const response = await getApiClient().POST(
      "/api/v1/leads/{id}/tasks/{taskId}/actions/complete",
      {
        params: {
          header: { "Idempotency-Key": crypto.randomUUID() },
          path: { id: leadId, taskId },
        },
      },
    );
    setBusy(false);
    if (!response.data) setActionError(apiErrorMessage(response.error));
    else await load();
  };

  const linkDocument = async (document: { id: string; originalFilename: string }) => {
    const response = await getApiClient().POST("/api/v1/leads/{id}/documents", {
      body: { documentId: document.id, purpose: "intake_attachment" },
      params: {
        header: { "Idempotency-Key": crypto.randomUUID() },
        path: { id: leadId },
      },
    });
    if (!response.data) throw new Error(apiErrorMessage(response.error));
    await load();
  };

  if (state.name === "loading") return <LeadDetailSkeleton />;
  if (state.name === "error") {
    return (
      <div className="intake-page">
        <div className="intake-state intake-state-error full-panel-state" role="alert">
          <AlertTriangle size={26} />
          <h1>Lead unavailable</h1>
          <p>{state.message}</p>
          <Link className="button button-secondary" href="/leads">
            Back to Leads
          </Link>
        </div>
      </div>
    );
  }

  const { lead } = state;
  const forward = nextLeadAction(lead.status);
  const terminal = isTerminalLeadStatus(lead.status);
  const serviceInstructions =
    lead.materialDelivery?.deliveryInstructions ?? lead.dumpTrailerRental?.deliveryInstructions;

  return (
    <div className="intake-page lead-detail-page">
      <section className="lead-detail-heading">
        <div>
          <Link className="back-link" href="/leads">
            <ArrowLeft size={15} /> Leads
          </Link>
          <span className="page-eyebrow">{lead.leadNumber}</span>
          <h1>{lead.customer.displayName}</h1>
          <p>{lead.summary}</p>
        </div>
        <div className="lead-heading-actions">
          <span className={`lead-status lead-status-${lead.status}`}>
            {humanizeIntakeValue(lead.status)}
          </span>
          {forward && (
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => void transition(forward.action)}
              type="button"
            >
              {forward.label} <ArrowRight size={16} />
            </button>
          )}
        </div>
      </section>

      {actionError && (
        <div className="inline-form-error" role="alert">
          <AlertTriangle size={18} /> <span>{actionError}</span>
        </div>
      )}

      <div className="lead-detail-grid">
        <div className="lead-detail-main">
          <section className="panel lead-overview-panel">
            <div className="panel-heading compact">
              <div>
                <span className="panel-kicker">Opportunity</span>
                <h2>Service request</h2>
              </div>
              <span className={`service-icon service-icon-${lead.serviceType}`}>
                {lead.serviceType === "material_delivery" ? (
                  <Truck size={18} />
                ) : (
                  <PackageOpen size={18} />
                )}
              </span>
            </div>
            <div className="lead-fact-grid">
              <div>
                <span>Service</span>
                <strong>
                  {lead.serviceType === "material_delivery"
                    ? "Material delivery"
                    : "Dump trailer rental"}
                </strong>
              </div>
              <div>
                <span>Source</span>
                <strong>{humanizeIntakeValue(lead.source)}</strong>
              </div>
              {lead.materialDelivery && (
                <>
                  <div>
                    <span>Material</span>
                    <strong>{lead.materialDelivery.materialDescription}</strong>
                  </div>
                  <div>
                    <span>Estimated quantity</span>
                    <strong>
                      {lead.materialDelivery.estimatedQuantity}{" "}
                      {humanizeIntakeValue(lead.materialDelivery.quantityUnit)}
                    </strong>
                  </div>
                </>
              )}
              {lead.dumpTrailerRental && (
                <>
                  <div>
                    <span>Debris</span>
                    <strong>{lead.dumpTrailerRental.debrisType}</strong>
                  </div>
                  <div>
                    <span>Rental window</span>
                    <strong>
                      {shortDate(lead.dumpTrailerRental.rentalStartDate)}–
                      {shortDate(lead.dumpTrailerRental.rentalEndDate)}
                    </strong>
                  </div>
                </>
              )}
            </div>
            {serviceInstructions && (
              <div className="instruction-callout">
                <MessageSquareText size={16} />
                <p>{serviceInstructions}</p>
              </div>
            )}
          </section>

          {lead.status === "estimating" && (
            <section className="panel lead-overview-panel">
              <div className="panel-heading compact">
                <div>
                  <span className="panel-kicker">Commercial</span>
                  <h2>Build Estimate</h2>
                </div>
                <ClipboardCheck size={19} />
              </div>
              <EstimateBuilder lead={lead} />
            </section>
          )}

          <section className="panel lead-activity-panel">
            <div className="panel-heading compact">
              <div>
                <span className="panel-kicker">History</span>
                <h2>Timeline</h2>
              </div>
              <span className="count-pill">{lead.timeline.length} events</span>
            </div>
            {lead.timeline.length === 0 ? (
              <p className="quiet-panel-copy">No activity yet.</p>
            ) : (
              <div className="timeline-list">
                {lead.timeline.map((event) => (
                  <div className="timeline-row" key={event.id}>
                    <span>
                      <Circle size={9} fill="currentColor" />
                    </span>
                    <div>
                      <strong>{leadTimelineLabel(event.eventType)}</strong>
                      <small>{dateTime(event.occurredAt)}</small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel lead-notes-panel">
            <div className="panel-heading compact">
              <div>
                <span className="panel-kicker">Team context</span>
                <h2>Notes</h2>
              </div>
            </div>
            <form className="quick-add-form" onSubmit={(event) => void addNote(event)}>
              <label className="visually-hidden" htmlFor="lead-note">
                Add an internal note
              </label>
              <textarea
                id="lead-note"
                name="body"
                placeholder="Add an internal note…"
                required
                rows={3}
              />
              <button className="button button-secondary" disabled={busy} type="submit">
                <Plus size={15} /> Add note
              </button>
            </form>
            {lead.notes.length === 0 ? (
              <p className="quiet-panel-copy">No notes have been added.</p>
            ) : (
              <div className="note-list">
                {lead.notes.map((note) => (
                  <article key={note.id}>
                    <p>{note.body}</p>
                    <small>
                      {dateTime(note.createdAt)} · {note.visibility}
                    </small>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="lead-detail-sidebar">
          <section className="panel lead-contact-panel">
            <div className="panel-heading compact">
              <div>
                <span className="panel-kicker">Customer</span>
                <h2>Contact</h2>
              </div>
              <Building2 size={19} />
            </div>
            <Link className="customer-detail-link" href={`/customers/${lead.customer.id}`}>
              <strong>{lead.customer.displayName}</strong>
              <ArrowRight size={15} />
            </Link>
            <div className="contact-lines">
              <span>
                <Phone size={14} /> {lead.primaryContact.phone ?? "No phone"}
              </span>
              <span>
                <Mail size={14} /> {lead.primaryContact.email ?? "No email"}
              </span>
              <span>
                <MapPin size={14} /> {lead.serviceLocation.addressLine1},{" "}
                {lead.serviceLocation.city}, {lead.serviceLocation.region}{" "}
                {lead.serviceLocation.postalCode}
              </span>
            </div>
            {lead.serviceLocation.accessNotes && (
              <p className="access-note">
                <MapPin size={14} /> {lead.serviceLocation.accessNotes}
              </p>
            )}
          </section>

          <section className="panel lead-tasks-panel">
            <div className="panel-heading compact">
              <div>
                <span className="panel-kicker">Follow-up</span>
                <h2>Tasks</h2>
              </div>
              <ClipboardCheck size={19} />
            </div>
            <form className="task-add-form" onSubmit={(event) => void addTask(event)}>
              <label>
                <span>Task</span>
                <input name="title" placeholder="Confirm driveway access" required />
              </label>
              <label>
                <span>
                  Due date <small>Optional</small>
                </span>
                <input name="dueAt" type="date" />
              </label>
              <button className="button button-secondary" disabled={busy} type="submit">
                <Plus size={15} /> Add task
              </button>
            </form>
            {lead.tasks.length === 0 ? (
              <p className="quiet-panel-copy">No open tasks.</p>
            ) : (
              <div className="task-list">
                {lead.tasks.map((task) => (
                  <button
                    disabled={busy || task.status !== "open"}
                    key={task.id}
                    onClick={() => void completeTask(task.id)}
                    type="button"
                  >
                    {task.status === "completed" ? (
                      <CheckCircle2 size={17} />
                    ) : (
                      <Circle size={17} />
                    )}
                    <span>
                      <strong>{task.title}</strong>
                      <small>{task.dueAt ? `Due ${shortDate(task.dueAt)}` : "No due date"}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <DocumentUploadCard onAvailable={linkDocument} />
          {lead.documents.length > 0 && (
            <section className="panel linked-documents-panel">
              <div className="panel-heading compact">
                <div>
                  <span className="panel-kicker">Lead files</span>
                  <h2>Documents</h2>
                </div>
              </div>
              {lead.documents.map((document) => (
                <div className="linked-document" key={document.id}>
                  <FileText size={17} />
                  <span>
                    <strong>{document.originalFilename}</strong>
                    <small>{humanizeIntakeValue(document.purpose)}</small>
                  </span>
                </div>
              ))}
            </section>
          )}

          {!terminal && (
            <section className="panel close-lead-panel">
              <div className="panel-heading compact">
                <div>
                  <span className="panel-kicker">Terminal outcome</span>
                  <h2>Close Lead</h2>
                </div>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  const action = data.get("action");
                  const reason = data.get("reason");
                  if (
                    typeof action === "string" &&
                    typeof reason === "string" &&
                    isLeadIntakeAction(action)
                  ) {
                    void transition(action, reason.trim());
                  }
                }}
              >
                <label>
                  <span>Outcome</span>
                  <select defaultValue="mark-lost" name="action">
                    {terminalActions.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Reason</span>
                  <textarea
                    name="reason"
                    placeholder="Why is this opportunity closing?"
                    required
                    rows={3}
                  />
                </label>
                <button className="button button-secondary" disabled={busy} type="submit">
                  Save outcome
                </button>
              </form>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function LeadDetailSkeleton() {
  return (
    <div className="intake-page lead-detail-page" aria-label="Loading Lead" role="status">
      <div className="skeleton skeleton-title" />
      <div className="lead-detail-grid">
        <div className="skeleton detail-skeleton-card" />
        <div className="skeleton detail-skeleton-card" />
      </div>
    </div>
  );
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" }).format(
    new Date(`${value.slice(0, 10)}T12:00:00`),
  );
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}
