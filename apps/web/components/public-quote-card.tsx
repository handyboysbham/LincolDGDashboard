"use client";

import type { components } from "@ldg/api-client";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Clock3,
  LoaderCircle,
  LockKeyhole,
  Phone,
  XCircle,
} from "lucide-react";
import { type SyntheticEvent, useEffect, useState } from "react";

import { apiErrorCode, apiErrorMessage, getApiClient } from "../lib/api-client";
import { formatMoney, humanizeCommercialValue, shortDate } from "../lib/commercial-format";

type Quote = components["schemas"]["PublicQuoteDto"];
type Project = components["schemas"]["ProjectDto"];
type State =
  | { name: "loading" }
  | { code?: string; message: string; name: "failure" }
  | { name: "available"; quote: Quote }
  | { acceptedAt: string; name: "accepted"; project: Project }
  | { name: "declined"; quote: Quote };

const consentText =
  "I accept this Quote, its scope, price, deposit requirement, and terms for the customer named above.";

export function PublicQuoteCard({ token }: { token: string }) {
  const [state, setState] = useState<State>({ name: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [showDecline, setShowDecline] = useState(false);

  useEffect(() => {
    let active = true;
    void getApiClient()
      .GET("/api/v1/public/quotes/{token}", {
        params: { path: { token } },
        referrerPolicy: "no-referrer",
      })
      .then((response) => {
        if (!active) return;
        if (response.data)
          setState(
            response.data.status === "declined"
              ? { name: "declined", quote: response.data }
              : { name: "available", quote: response.data },
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

  const accept = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.name !== "available") return;
    const acceptedNameValue = new FormData(event.currentTarget).get("acceptedName");
    const acceptedName = typeof acceptedNameValue === "string" ? acceptedNameValue.trim() : "";
    setBusy(true);
    setActionError(undefined);
    const response = await getApiClient().POST("/api/v1/public/quotes/{token}/actions/accept", {
      body: { acceptedName, consentText, contentHash: state.quote.contentHash },
      params: { path: { token } },
      referrerPolicy: "no-referrer",
    });
    setBusy(false);
    if (!response.data) setActionError(apiErrorMessage(response.error));
    else
      setState({
        acceptedAt: response.data.acceptedAt,
        name: "accepted",
        project: response.data.project,
      });
  };

  const decline = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.name !== "available") return;
    const reasonValue = new FormData(event.currentTarget).get("reason");
    const reason = typeof reasonValue === "string" ? reasonValue.trim() : "";
    setBusy(true);
    setActionError(undefined);
    const response = await getApiClient().POST("/api/v1/public/quotes/{token}/actions/decline", {
      body: { reason },
      params: { path: { token } },
      referrerPolicy: "no-referrer",
    });
    setBusy(false);
    if (!response.data) setActionError(apiErrorMessage(response.error));
    else setState({ name: "declined", quote: response.data });
  };

  if (state.name === "loading")
    return (
      <div aria-live="polite" className="customer-state-card">
        <span className="customer-state-icon">
          <LoaderCircle className="spin" />
        </span>
        <span className="page-eyebrow">Secure Quote</span>
        <h1>Checking your offer…</h1>
        <p>We’re verifying this private link and the current Quote Version.</p>
      </div>
    );
  if (state.name === "failure") {
    const copy = failureCopy(state.code);
    return (
      <div className="customer-state-card">
        <span className="customer-state-icon is-error">
          <CircleAlert />
        </span>
        <span className="page-eyebrow">{copy.eyebrow}</span>
        <h1>{copy.title}</h1>
        <p>{copy.detail || state.message}</p>
        <a className="button button-primary customer-contact" href="tel:+14025550142">
          <Phone size={17} /> Call (402) 555-0142
        </a>
      </div>
    );
  }
  if (state.name === "accepted")
    return (
      <div className="customer-state-card">
        <span className="customer-state-icon is-success">
          <CheckCircle2 />
        </span>
        <span className="page-eyebrow">Quote accepted</span>
        <h1>Thank you. Your Project is started.</h1>
        <p>
          Your acceptance was recorded on {shortDate(state.acceptedAt)}. Our team will contact you
          with scheduling and next steps.
        </p>
        <div className="customer-project-result">
          <span>Project</span>
          <strong>{state.project.projectNumber}</strong>
          <small>{humanizeCommercialValue(state.project.status)}</small>
        </div>
      </div>
    );
  if (state.name === "declined")
    return (
      <div className="customer-state-card">
        <span className="customer-state-icon is-error">
          <XCircle />
        </span>
        <span className="page-eyebrow">Quote declined</span>
        <h1>We’ve recorded your response.</h1>
        <p>
          No work has been scheduled. Call us if you’d like to discuss a revised offer for{" "}
          {state.quote.quoteNumber}.
        </p>
        <a className="button button-primary customer-contact" href="tel:+14025550142">
          <Phone size={17} /> Contact Lincoln D&amp;G
        </a>
      </div>
    );

  const { quote } = state;
  return (
    <article className="public-quote-card">
      <header className="public-quote-heading">
        <div>
          <span className="page-eyebrow">Quote {quote.quoteNumber}</span>
          <h1>{quote.customerName}</h1>
          <p>
            {humanizeCommercialValue(quote.serviceType)} · {quote.locationSummary}
          </p>
        </div>
        <div className="public-quote-expiry">
          <Clock3 size={15} />
          <span>Valid through</span>
          <strong>{shortDate(quote.expiresAt)}</strong>
        </div>
      </header>
      <section className="public-quote-scope">
        <span>Proposed scope</span>
        <p>{quote.scope}</p>
      </section>
      <section className="public-quote-lines">
        <div className="quote-line-header">
          <span>Description</span>
          <span>Quantity</span>
          <span>Total</span>
        </div>
        {quote.lineItems.map((line) => (
          <div className="quote-line" key={line.id}>
            <div>
              <strong>{line.description}</strong>
              <small>
                {formatMoney(line.unitPriceCents)} / {humanizeCommercialValue(line.unit)}
              </small>
            </div>
            <span>{line.quantity}</span>
            <b>{formatMoney(line.totalCents)}</b>
          </div>
        ))}
      </section>
      <section className="public-quote-total">
        <div>
          <span>Subtotal</span>
          <b>{formatMoney(quote.subtotalCents)}</b>
        </div>
        {quote.adjustmentCents !== 0 && (
          <div>
            <span>Adjustment</span>
            <b>{formatMoney(quote.adjustmentCents)}</b>
          </div>
        )}
        <div>
          <span>Tax</span>
          <b>{formatMoney(quote.taxCents)}</b>
        </div>
        <div className="grand-total">
          <span>Total</span>
          <b>{formatMoney(quote.totalCents)}</b>
        </div>
        <div>
          <span>Required deposit</span>
          <b>{formatMoney(quote.requiredDepositCents)}</b>
        </div>
      </section>
      <section className="public-quote-terms">
        {quote.terms.map((term) => (
          <article key={term.id}>
            <strong>{term.title}</strong>
            <p>{term.body}</p>
          </article>
        ))}
      </section>
      <section className="public-quote-response">
        <div className="public-response-heading">
          <LockKeyhole size={18} />
          <div>
            <strong>Respond securely</strong>
            <span>Your typed name and this exact offer version will be recorded.</span>
          </div>
        </div>
        {actionError && (
          <div className="inline-form-error" role="alert">
            <AlertTriangle size={16} /> {actionError}
          </div>
        )}
        {showDecline ? (
          <form
            onSubmit={(event) => {
              void decline(event);
            }}
          >
            <label className="field">
              <span>Why are you declining?</span>
              <textarea maxLength={1000} name="reason" required rows={3} />
            </label>
            <div className="commercial-form-actions">
              <button
                className="button button-secondary"
                onClick={() => {
                  setShowDecline(false);
                }}
                type="button"
              >
                Cancel
              </button>
              <button className="button danger-button" disabled={busy} type="submit">
                Decline Quote
              </button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={(event) => {
              void accept(event);
            }}
          >
            <p className="consent-copy">{consentText}</p>
            <label className="field">
              <span>Type your full name</span>
              <input
                autoComplete="name"
                maxLength={200}
                minLength={2}
                name="acceptedName"
                required
              />
            </label>
            <div className="public-response-actions">
              <button
                className="button button-secondary"
                onClick={() => {
                  setShowDecline(true);
                }}
                type="button"
              >
                Decline
              </button>
              <button className="button button-primary" disabled={busy} type="submit">
                <CheckCircle2 size={16} /> Accept Quote
              </button>
            </div>
          </form>
        )}
      </section>
    </article>
  );
}

function failureCopy(code: string | undefined): { detail: string; eyebrow: string; title: string } {
  if (code === "QUOTE_EXPIRED")
    return {
      detail: "This offer has passed its valid-through date. Contact us for a current Quote.",
      eyebrow: "Quote expired",
      title: "This offer is no longer active.",
    };
  if (code === "QUOTE_WITHDRAWN")
    return {
      detail:
        "Lincoln Dirt & Gravel withdrew this version. We can help you locate the current offer.",
      eyebrow: "Quote withdrawn",
      title: "This offer was withdrawn.",
    };
  if (code === "QUOTE_SUPERSEDED")
    return {
      detail: "A newer Quote Version replaced this one. Please use the latest link we sent.",
      eyebrow: "Newer version available",
      title: "This Quote was revised.",
    };
  if (code === "QUOTE_LINK_REVOKED")
    return {
      detail: "This private link is no longer active. Contact us for a fresh link.",
      eyebrow: "Link revoked",
      title: "This link is no longer available.",
    };
  return {
    detail: "We couldn’t verify this private Quote link. Check the full link or contact our team.",
    eyebrow: "Secure Quote unavailable",
    title: "We can’t open this Quote.",
  };
}
