"use client";

import { CircleAlert, RotateCcw } from "lucide-react";

export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="full-page-state">
      <div className="state-icon state-icon-error">
        <CircleAlert aria-hidden="true" />
      </div>
      <span className="page-eyebrow">Workspace unavailable</span>
      <h1>We couldn’t load the dashboard.</h1>
      <p>Your work is safe. Try the request again, or return in a moment.</p>
      <button className="button button-primary" onClick={reset} type="button">
        <RotateCcw size={17} /> Try again
      </button>
    </main>
  );
}
