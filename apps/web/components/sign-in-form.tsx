"use client";

import { LockKeyhole } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { type SyntheticEvent, useState } from "react";

import { safePostAuthPath } from "../lib/auth-mode";
import { createBrowserSupabaseClient } from "../lib/supabase/client";
import { Brand } from "./brand";

export function SignInForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [error, setError] = useState<string | undefined>(() =>
    search.get("error") === "confirmation"
      ? "That confirmation link is invalid or expired. Request a new link, then try again."
      : undefined,
  );
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const emailValue = form.get("email");
    const passwordValue = form.get("password");
    const email = typeof emailValue === "string" ? emailValue.trim() : "";
    const password = typeof passwordValue === "string" ? passwordValue : "";
    try {
      const { error: authError } = await createBrowserSupabaseClient().auth.signInWithPassword({
        email,
        password,
      });
      if (authError) throw authError;
      router.replace(safePostAuthPath(search.get("next")));
      router.refresh();
    } catch {
      setError("We could not sign you in. Check your email and password, then try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <section aria-labelledby="sign-in-heading" className="auth-card">
        <div className="auth-brand">
          <Brand />
        </div>
        <div className="auth-icon">
          <LockKeyhole aria-hidden="true" size={22} />
        </div>
        <span className="page-eyebrow">Secure staff access</span>
        <h1 id="sign-in-heading">Sign in to operations</h1>
        <p>Use your Lincoln Dirt &amp; Gravel staff account.</p>
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <label htmlFor="email">Email address</label>
          <input autoComplete="username" id="email" name="email" required type="email" />
          <label htmlFor="password">Password</label>
          <input
            autoComplete="current-password"
            id="password"
            name="password"
            required
            type="password"
          />
          {error && (
            <div aria-live="polite" className="auth-error" role="alert">
              {error}
            </div>
          )}
          <button className="button button-primary" disabled={submitting} type="submit">
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
