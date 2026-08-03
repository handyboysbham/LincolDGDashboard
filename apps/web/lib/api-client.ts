import { createApiClient } from "@ldg/api-client";

export function getApiClient() {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!baseUrl) throw new Error("NEXT_PUBLIC_API_BASE_URL is required");
  return createApiClient({ baseUrl });
}

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
