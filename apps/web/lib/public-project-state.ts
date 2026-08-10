export type PublicProjectFailure = "expired" | "invalid" | "revoked" | "unavailable";

export function publicProjectFailure(code: string | undefined): PublicProjectFailure {
  if (code === "PROJECT_LINK_EXPIRED") return "expired";
  if (code === "PROJECT_LINK_REVOKED") return "revoked";
  if (code === "PROJECT_LINK_INVALID") return "invalid";
  return "unavailable";
}
