"use client";

import {
  Check,
  Copy,
  Download,
  FileCheck2,
  FileUp,
  Link2,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { useRef, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";

type UploadState =
  | { name: "idle" }
  | { name: "preparing" }
  | { name: "uploading"; progress: number }
  | { name: "validating" }
  | { documentId: string; filename: string; name: "available" }
  | { message: string; name: "error" };

export function DocumentUploadCard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ name: "idle" });
  const [customerLink, setCustomerLink] = useState<string>();
  const [copied, setCopied] = useState(false);

  const upload = async (file: File) => {
    setCustomerLink(undefined);
    setCopied(false);
    setState({ name: "preparing" });
    try {
      if (!isSupportedMediaType(file.type)) {
        throw new Error("Choose a PDF, JPG, PNG, or text document");
      }
      const sha256 = await digest(file);
      const client = getApiClient();
      const idempotencyKey = crypto.randomUUID();
      const created = await client.POST("/api/v1/documents/uploads", {
        body: {
          mediaType: file.type,
          originalFilename: file.name,
          sha256,
          sizeBytes: file.size,
        },
        params: { header: { "Idempotency-Key": idempotencyKey } },
      });
      if (!created.data) throw new Error(apiErrorMessage(created.error));

      setState({ name: "uploading", progress: 45 });
      const uploaded = await fetch(created.data.upload.url, {
        body: file,
        headers: created.data.upload.headers,
        method: "PUT",
      });
      if (!uploaded.ok) throw new Error("Object upload failed");

      setState({ name: "validating" });
      const completed = await client.POST("/api/v1/documents/{id}/actions/complete", {
        params: { path: { id: created.data.document.id } },
      });
      if (!completed.data) throw new Error(apiErrorMessage(completed.error));
      setState({
        documentId: completed.data.id,
        filename: completed.data.originalFilename,
        name: "available",
      });
    } catch (error) {
      setState({ message: apiErrorMessage(error), name: "error" });
    }
  };

  const download = async (documentId: string) => {
    const response = await getApiClient().POST("/api/v1/documents/{id}/actions/download", {
      params: { path: { id: documentId } },
    });
    if (response.data) window.location.assign(response.data.url);
    else setState({ message: apiErrorMessage(response.error), name: "error" });
  };

  const share = async (documentId: string) => {
    const idempotencyKey = crypto.randomUUID();
    const response = await getApiClient().POST("/api/v1/documents/{id}/public-links", {
      body: { expiresInSeconds: 86_400, scope: "download" },
      params: {
        header: { "Idempotency-Key": idempotencyKey },
        path: { id: documentId },
      },
    });
    if (!response.data) {
      setState({ message: apiErrorMessage(response.error), name: "error" });
      return;
    }
    setCustomerLink(
      `${window.location.origin}/customer/documents/${encodeURIComponent(response.data.token)}`,
    );
  };

  const copyLink = async () => {
    if (!customerLink) return;
    await navigator.clipboard.writeText(customerLink);
    setCopied(true);
  };

  return (
    <section className="panel upload-card">
      <div className="panel-heading compact">
        <div>
          <span className="panel-kicker">Secure documents</span>
          <h2>Upload a file</h2>
        </div>
        <ShieldCheck aria-hidden="true" className="security-icon" size={22} />
      </div>
      <input
        accept="application/pdf,image/jpeg,image/png,text/plain"
        className="visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
        ref={inputRef}
        type="file"
      />

      {(state.name === "idle" || state.name === "error") && (
        <button className="upload-dropzone" onClick={() => inputRef.current?.click()} type="button">
          <span className="upload-icon">
            <FileUp aria-hidden="true" size={21} />
          </span>
          <strong>{state.name === "error" ? "Try another file" : "Choose a document"}</strong>
          <span>PDF, JPG, PNG, or text · up to 20 MB</span>
        </button>
      )}

      {state.name === "error" && (
        <div className="inline-error" role="alert">
          <span>{state.message}</span>
          <button
            onClick={() => {
              setState({ name: "idle" });
            }}
            type="button"
          >
            <RotateCcw size={14} /> Reset
          </button>
        </div>
      )}

      {(state.name === "preparing" ||
        state.name === "uploading" ||
        state.name === "validating") && (
        <div aria-live="polite" className="upload-progress">
          <LoaderCircle aria-hidden="true" className="spin" size={21} />
          <div>
            <strong>
              {state.name === "preparing"
                ? "Preparing securely…"
                : state.name === "uploading"
                  ? "Uploading to private storage…"
                  : "Validating document…"}
            </strong>
            <span>
              {state.name === "validating"
                ? "Checking type, size, and fingerprint"
                : "Keep this page open for a moment"}
            </span>
          </div>
        </div>
      )}

      {state.name === "available" && (
        <div className="upload-success" aria-live="polite">
          <div className="success-file">
            <span>
              <FileCheck2 aria-hidden="true" size={20} />
            </span>
            <div>
              <strong>{state.filename}</strong>
              <small>
                <Check size={12} /> Validated and available
              </small>
            </div>
          </div>
          <div className="document-actions">
            <button onClick={() => void download(state.documentId)} type="button">
              <Download size={15} /> Download
            </button>
            <button onClick={() => void share(state.documentId)} type="button">
              <Link2 size={15} /> Customer link
            </button>
          </div>
          {customerLink && (
            <button className="copy-link" onClick={() => void copyLink()} type="button">
              <span>{customerLink}</span>
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          )}
        </div>
      )}
      <p className="security-note">
        <ShieldCheck size={14} /> Files stay private until validation completes.
      </p>
    </section>
  );
}

const supportedMediaTypes = ["application/pdf", "image/jpeg", "image/png", "text/plain"] as const;

function isSupportedMediaType(value: string): value is (typeof supportedMediaTypes)[number] {
  return (supportedMediaTypes as readonly string[]).includes(value);
}

async function digest(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
