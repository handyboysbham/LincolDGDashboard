export type WebAuthMode = "development" | "supabase";

export function webAuthMode(): WebAuthMode {
  const mode = process.env.NEXT_PUBLIC_AUTH_MODE ?? "development";
  if (mode !== "development" && mode !== "supabase") {
    throw new Error("NEXT_PUBLIC_AUTH_MODE must be development or supabase");
  }
  return mode;
}

export function isPublicWebPath(pathname: string): boolean {
  return (
    pathname === "/sign-in" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/customer/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/og.png"
  );
}

export function safePostAuthPath(candidate: string | null): string {
  if (!candidate) return "/";
  try {
    const base = new URL("https://staff.ldg.invalid");
    const destination = new URL(candidate, base);
    if (destination.origin !== base.origin || !candidate.startsWith("/")) return "/";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/";
  }
}
