"use client";

import type { components } from "@ldg/api-client";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  FileSignature,
  RefreshCw,
  Send,
} from "lucide-react";
import Link from "next/link";
import { type SyntheticEvent, useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";
import { formatMoney, humanizeCommercialValue } from "../lib/commercial-format";

type Project = components["schemas"]["ProjectDetailDto"];
type State =
  { name: "loading" } | { message: string; name: "error" } | { name: "ready"; project: Project };
const businessConsent = "I approve and sign this exact Contract for Lincoln Dirt and Gravel.";

export function ProjectDetail({ projectId }: { projectId: string }) {
  const [state, setState] = useState<State>({ name: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [customerPath, setCustomerPath] = useState<string>();
  const load = useCallback(async () => {
    const response = await getApiClient().GET("/api/v1/projects/{id}", {
      params: { path: { id: projectId } },
    });
    setState(
      response.data
        ? { name: "ready", project: response.data }
        : { message: apiErrorMessage(response.error), name: "error" },
    );
  }, [projectId]);
  useEffect(() => void load(), [load]);

  const run = async (operation: () => Promise<{ data?: Project; error?: unknown }>) => {
    setBusy(true);
    setActionError(undefined);
    try {
      const response = await operation();
      if (!response.data) throw new Error(apiErrorMessage(response.error));
      setState({ name: "ready", project: response.data });
    } catch (error) {
      setActionError(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const generate = () =>
    run(() =>
      getApiClient().POST("/api/v1/projects/{id}/actions/generate-contract", {
        params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: projectId } },
      }),
    );
  const signBusiness = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.name !== "ready" || !state.project.contract) return;
    const value = new FormData(event.currentTarget).get("typedName");
    const typedName = typeof value === "string" ? value.trim() : "";
    setBusy(true);
    setActionError(undefined);
    const response = await getApiClient().POST("/api/v1/contracts/{id}/actions/sign-business", {
      body: {
        consentText: businessConsent,
        contentHash: state.project.contract.contentHash,
        typedName,
      },
      params: {
        header: { "Idempotency-Key": crypto.randomUUID() },
        path: { id: state.project.contract.id },
      },
    });
    if (!response.data) setActionError(apiErrorMessage(response.error));
    else await load();
    setBusy(false);
  };
  const sendContract = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.name !== "ready" || !state.project.contract) return;
    const value = new FormData(event.currentTarget).get("recipient");
    const recipient = typeof value === "string" ? value.trim() : "";
    setBusy(true);
    setActionError(undefined);
    const response = await getApiClient().POST("/api/v1/contracts/{id}/actions/send", {
      body: { expiresInDays: 10, recipient },
      params: {
        header: { "Idempotency-Key": crypto.randomUUID() },
        path: { id: state.project.contract.id },
      },
    });
    if (!response.data) setActionError(apiErrorMessage(response.error));
    else {
      setCustomerPath(response.data.customerPath);
      await load();
    }
    setBusy(false);
  };
  const confirmDeposit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("evidenceReference");
    const evidenceReference = typeof value === "string" ? value.trim() : "";
    await run(() =>
      getApiClient().POST("/api/v1/projects/{id}/actions/confirm-deposit-readiness", {
        body: { evidenceReference },
        params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: projectId } },
      }),
    );
  };
  const transition = (
    action:
      | "activate"
      | "close"
      | "complete"
      | "complete-financially"
      | "complete-operationally"
      | "start-planning",
  ) =>
    run(() =>
      getApiClient().POST("/api/v1/projects/{id}/actions/{action}", {
        body: {},
        params: {
          header: { "Idempotency-Key": crypto.randomUUID() },
          path: { action, id: projectId },
        },
      }),
    );

  if (state.name === "loading")
    return (
      <div className="intake-page">
        <section className="panel commercial-loading">
          <RefreshCw className="spin" size={22} /> Loading Project…
        </section>
      </div>
    );
  if (state.name === "error")
    return (
      <div className="intake-page">
        <section className="panel intake-state commercial-empty" role="alert">
          <AlertTriangle size={27} />
          <h1>Project unavailable</h1>
          <p>{state.message}</p>
          <Link className="button button-secondary" href="/projects">
            Back to Projects
          </Link>
        </section>
      </div>
    );
  const { project } = state;
  const nextAction =
    project.status === "ready_for_planning"
      ? "start-planning"
      : project.status === "planning"
        ? "activate"
        : project.status === "active"
          ? "complete-operationally"
          : project.status === "operationally_complete"
            ? "complete-financially"
            : project.status === "financially_complete"
              ? "complete"
              : project.status === "completed"
                ? "close"
                : undefined;
  return (
    <div className="intake-page operations-page">
      <section className="lead-detail-heading">
        <div>
          <Link className="back-link" href="/projects">
            <ArrowLeft size={15} /> Projects
          </Link>
          <span className="page-eyebrow">{project.projectNumber}</span>
          <h1>{project.customerName}</h1>
          <p>{project.serviceLocation}</p>
        </div>
        <div className="commercial-action-row">
          <span className={`commercial-status status-${project.status}`}>
            {humanizeCommercialValue(project.status)}
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
      {customerPath && (
        <div className="secure-link-banner">
          <FileSignature size={18} />
          <div>
            <strong>Secure Contract link created</strong>
            <span>{new URL(customerPath, window.location.origin).toString()}</span>
          </div>
          <button
            aria-label="Copy customer Contract link"
            onClick={() =>
              void navigator.clipboard.writeText(
                new URL(customerPath, window.location.origin).toString(),
              )
            }
          >
            <Copy size={16} />
          </button>
        </div>
      )}
      <div className="operations-detail-grid">
        <main className="operations-stack">
          <section className="panel operations-summary">
            <div>
              <span>Accepted value</span>
              <strong>{formatMoney(project.acceptedValueCents)}</strong>
            </div>
            <div>
              <span>Required deposit</span>
              <strong>{formatMoney(project.requiredDepositCents)}</strong>
            </div>
            <div>
              <span>Contract</span>
              <strong>{humanizeCommercialValue(project.contractStatus)}</strong>
            </div>
            <div>
              <span>Deposit</span>
              <strong>{humanizeCommercialValue(project.depositStatus)}</strong>
            </div>
          </section>
          <section className="panel operations-section">
            <span className="page-eyebrow">Accepted scope</span>
            <h2>Outcome</h2>
            <p>{project.outcomeStatement}</p>
          </section>
          <section className="panel operations-section">
            <div className="operations-section-heading">
              <div>
                <span className="page-eyebrow">Independent work</span>
                <h2>Jobs</h2>
              </div>
              <Link className="button button-secondary" href="/jobs">
                All Jobs
              </Link>
            </div>
            {project.jobs.map((job) => (
              <Link className="operations-job-link" href={`/jobs/${job.id}`} key={job.id}>
                <div>
                  <strong>{job.jobNumber}</strong>
                  <small>{humanizeCommercialValue(job.serviceType)}</small>
                </div>
                <span>{humanizeCommercialValue(job.readiness)}</span>
                <b>{humanizeCommercialValue(job.status)}</b>
              </Link>
            ))}
          </section>
        </main>
        <aside className="operations-stack">
          {!project.contract && (
            <section className="panel operations-section">
              <FileSignature size={24} />
              <h2>Generate Contract</h2>
              <p>Freeze the accepted commercial snapshot before anyone signs.</p>
              <button
                className="button button-primary"
                disabled={busy}
                onClick={() => void generate()}
              >
                Generate Contract
              </button>
            </section>
          )}
          {project.contract && (
            <section className="panel operations-section">
              <span className="page-eyebrow">{project.contract.contractNumber}</span>
              <h2>Contract · {humanizeCommercialValue(project.contract.status)}</h2>
              <p>
                Content hash <code>{project.contract.contentHash.slice(0, 12)}…</code>
              </p>
              {project.contract.status === "draft" && (
                <form className="compact-form" onSubmit={(event) => void signBusiness(event)}>
                  <label>
                    Business signer
                    <input name="typedName" required />
                  </label>
                  <button className="button button-primary" disabled={busy}>
                    <FileSignature size={16} /> Sign as business
                  </button>
                </form>
              )}
              {project.contract.status === "business_signed" && (
                <form className="compact-form" onSubmit={(event) => void sendContract(event)}>
                  <label>
                    Customer email
                    <input name="recipient" required type="email" />
                  </label>
                  <button className="button button-primary" disabled={busy}>
                    <Send size={16} /> Send Contract
                  </button>
                </form>
              )}
              <div className="signature-list">
                {project.contract.signatures.map((signature) => (
                  <div key={signature.id}>
                    <CheckCircle2 size={15} />
                    <span>
                      {humanizeCommercialValue(signature.signerRole)} · {signature.typedName}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
          {project.contractStatus === "executed" && project.depositStatus === "pending" && (
            <section className="panel operations-section">
              <h2>Confirm deposit readiness</h2>
              <p>
                Record an external receipt or approval reference. This does not create accounting
                entries.
              </p>
              <form className="compact-form" onSubmit={(event) => void confirmDeposit(event)}>
                <label>
                  Evidence reference
                  <input name="evidenceReference" required />
                </label>
                <button className="button button-primary" disabled={busy}>
                  Confirm readiness
                </button>
              </form>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
