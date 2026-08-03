"use client";

import { CircleAlert, Download, FileCheck2, LoaderCircle, LockKeyhole, Phone } from "lucide-react";
import { useEffect, useState } from "react";

import { apiErrorCode, getApiClient } from "../lib/api-client";
import {
  publicDocumentFailure,
  type PublicDocumentFailureCopy,
} from "../lib/public-document-state";

type State =
  | { name: "loading" }
  | { detail: PublicDocumentFailureCopy; name: "failure" }
  | { expiresAt: string; filename: string; mediaType: string; name: "available"; url: string };

export function PublicDocumentCard({ token }: { token: string }) {
  const [state, setState] = useState<State>({ name: "loading" });

  useEffect(() => {
    let active = true;
    void getApiClient()
      .GET("/api/v1/public/document-links/{token}", {
        params: { path: { token } },
        referrerPolicy: "no-referrer",
      })
      .then((response) => {
        if (!active) return;
        if (response.data) {
          setState({
            expiresAt: response.data.expiresAt,
            filename: response.data.document.originalFilename,
            mediaType: response.data.document.mediaType,
            name: "available",
            url: response.data.url,
          });
        } else {
          setState({
            detail: publicDocumentFailure(apiErrorCode(response.error)),
            name: "failure",
          });
        }
      })
      .catch(() => {
        if (active)
          setState({ detail: publicDocumentFailure("DOCUMENT_UNAVAILABLE"), name: "failure" });
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
        <span className="page-eyebrow">Secure document</span>
        <h1>Checking your link…</h1>
        <p>We’re confirming access before making the file available.</p>
      </div>
    );
  }

  if (state.name === "failure") {
    return (
      <div className="customer-state-card">
        <span className="customer-state-icon is-error">
          <CircleAlert />
        </span>
        <span className="page-eyebrow">{state.detail.eyebrow}</span>
        <h1>{state.detail.title}</h1>
        <p>{state.detail.detail}</p>
        <a className="button button-primary customer-contact" href="tel:+14025550142">
          <Phone size={17} /> Call (402) 555-0142
        </a>
      </div>
    );
  }

  return (
    <div className="customer-state-card is-success">
      <span className="customer-state-icon is-success">
        <FileCheck2 />
      </span>
      <span className="page-eyebrow">Ready to download</span>
      <h1>Your document is ready.</h1>
      <p>This private download is available for a short time and works only for this file.</p>
      <div className="customer-file-row">
        <span>
          <FileCheck2 size={20} />
        </span>
        <div>
          <strong>{state.filename}</strong>
          <small>{state.mediaType}</small>
        </div>
      </div>
      <a
        className="button button-primary customer-download"
        href={state.url}
        referrerPolicy="no-referrer"
      >
        <Download size={18} /> Download securely
      </a>
      <div className="customer-security-note">
        <LockKeyhole size={15} />
        <span>Private, encrypted in transit, and time-limited</span>
      </div>
    </div>
  );
}
