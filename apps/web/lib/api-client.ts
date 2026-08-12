import { createApiClient } from "@ldg/api-client";

import { webAuthMode } from "./auth-mode";
import { createBrowserSupabaseClient } from "./supabase/client";

export function getApiClient() {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!baseUrl) throw new Error("NEXT_PUBLIC_API_BASE_URL is required");
  return createApiClient({ baseUrl, fetch: authenticatedFetch });
}

const authenticatedFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  if (webAuthMode() === "supabase" && !headers.has("authorization")) {
    const { data, error } = await createBrowserSupabaseClient().auth.getSession();
    if (error) throw error;
    if (data.session?.access_token) {
      headers.set("authorization", `Bearer ${data.session.access_token}`);
    }
  }
  return fetch(input, { ...init, headers });
};

export function apiErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "error" in error) {
    const wrapped = error.error;
    if (wrapped && typeof wrapped === "object" && "message" in wrapped) {
      const message = wrapped.message;
      if (typeof message === "string") return message;
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return "The request could not be completed. Please try again.";
}

export function apiErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "error" in error) {
    const wrapped = error.error;
    if (wrapped && typeof wrapped === "object" && "code" in wrapped) {
      return typeof wrapped.code === "string" ? wrapped.code : undefined;
    }
  }
  return undefined;
}
