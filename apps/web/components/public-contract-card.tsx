"use client";

import type { components } from "@ldg/api-client";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  FileSignature,
  LoaderCircle,
  LockKeyhole,
  Phone,
} from "lucide-react";
import { type SyntheticEvent, useEffect, useState } from "react";

import { apiErrorCode, apiErrorMessage, getApiClient } from "../lib/api-client";
import { formatMoney, humanizeCommercialValue, shortDate } from "../lib/commercial-format";

type Contract = components["schemas"]["PublicContractDto"];
type State =
  | { name: "loading" }
  | { code?: string; message: string; name: "failure" }
  | { contract: Contract; name: "available" }
  | { contract: Contract; name: "signed" };
const consentText =
  "I have reviewed and sign this exact Contract and agree to its scope, price, deposit requirement, and terms.";

export function PublicContractCard({ token }: { token: string }) {
  const [state, setState] = useState<State>({ name: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  useEffect(() => {
    let active = true;
    void getApiClient()
      .GET("/api/v1/public/contracts/{token}", {
        params: { path: { token } },
        referrerPolicy: "no-referrer",
      })
      .then((response) => {
        if (!active) return;
        if (response.data)
          setState(
            response.data.status === "executed"
              ? { contract: response.data, name: "signed" }
              : { contract: response.data, name: "available" },
          );
        else {
          const code = apiErrorCode(response.error);
          setState({
            ...(code ? { code } : {}),
            message: apiErrorMessage(response.error),
            name: "failure",
          });
        }
      })
      .catch((error: unknown) => {
        if (active) setState({ message: apiErrorMessage(error), name: "failure" });
      });
    return () => {
      active = false;
    };
  }, [token]);
  const sign = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.name !== "available") return;
    const value = new FormData(event.currentTarget).get("typedName");
    const typedName = typeof value === "string" ? value.trim() : "";
    setBusy(true);
    setActionError(undefined);
    const response = await getApiClient().POST("/api/v1/public/contracts/{token}/actions/sign", {
      body: { consentText, contentHash: state.contract.contentHash, typedName },
      params: { path: { token } },
      referrerPolicy: "no-referrer",
    });
    if (!response.data) setActionError(apiErrorMessage(response.error));
    else setState({ contract: response.data, name: "signed" });
    setBusy(false);
  };
  if (state.name === "loading")
    return (
      <div aria-live="polite" className="customer-state-card">
        <span className="customer-state-icon">
          <LoaderCircle className="spin" />
        </span>
        <span className="page-eyebrow">Secure Contract</span>
        <h1>Checking your agreement…</h1>
        <p>We’re verifying this private link and exact Contract content.</p>
      </div>
    );
  if (state.name === "failure")
    return (
      <div className="customer-state-card">
        <span className="customer-state-icon is-error">
          <CircleAlert />
        </span>
        <span className="page-eyebrow">Contract unavailable</span>
        <h1>This secure link cannot be opened.</h1>
        <p>{state.message}</p>
        <a className="button button-primary customer-contact" href="tel:+14025550142">
          <Phone size={17} /> Call (402) 555-0142
        </a>
      </div>
    );
  if (state.name === "signed")
    return (
      <div className="customer-state-card">
        <span className="customer-state-icon is-success">
          <CheckCircle2 />
        </span>
        <span className="page-eyebrow">Contract executed</span>
        <h1>Thank you. Your signature is recorded.</h1>
        <p>
          Our team will confirm deposit readiness and contact you about planning and schedule
          availability.
        </p>
        <div className="customer-project-result">
          <span>Contract</span>
          <strong>{state.contract.contractNumber}</strong>
          <small>
            Executed ·{" "}
            {shortDate(
              state.contract.signatures.find((signature) => signature.signerRole === "customer")
                ?.signedAt ?? null,
            )}
          </small>
        </div>
      </div>
    );
  const { contract } = state;
  return (
    <article className="public-quote-card public-contract-card">
      <header className="public-quote-heading">
        <div>
          <span className="page-eyebrow">Contract {contract.contractNumber}</span>
          <h1>{contract.customerName}</h1>
          <p>{contract.serviceLocation}</p>
        </div>
        <FileSignature size={34} />
      </header>
      <section className="public-quote-scope">
        <span>Accepted scope</span>
        <p>{contract.scope}</p>
      </section>
      <section className="contract-money-grid">
        <div>
          <span>Accepted value</span>
          <strong>{formatMoney(contract.acceptedValueCents)}</strong>
        </div>
        <div>
          <span>Required deposit</span>
          <strong>{formatMoney(contract.requiredDepositCents)}</strong>
        </div>
      </section>
      <section className="public-quote-terms">
        {contract.terms.map((term, index) => (
          <article key={term}>
            <strong>Term {index + 1}</strong>
            <p>{term}</p>
          </article>
        ))}
      </section>
      <section className="public-quote-response">
        <div className="public-response-heading">
          <LockKeyhole size={18} />
          <div>
            <strong>Sign securely</strong>
            <span>Your typed name and this exact Contract hash will be recorded.</span>
          </div>
        </div>
        {actionError && (
          <div className="inline-form-error" role="alert">
            <AlertTriangle size={16} /> {actionError}
          </div>
        )}
        <form className="public-signature-form" onSubmit={(event) => void sign(event)}>
          <label>
            Full legal name
            <input name="typedName" required />
          </label>
          <label className="customer-consent">
            <input required type="checkbox" />
            <span>{consentText}</span>
          </label>
          <button className="button button-primary" disabled={busy}>
            {busy ? "Recording…" : "Sign Contract"}
          </button>
        </form>
        <small>
          Reference: {contract.contentHash.slice(0, 16)}… ·{" "}
          {humanizeCommercialValue(contract.status)}
        </small>
      </section>
    </article>
  );
}
