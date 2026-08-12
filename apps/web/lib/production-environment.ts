type WebEnvironment = Readonly<Record<string, string | undefined>>;

const requiredWebVariables = [
  "APP_ENV",
  "LDG_PROCESS",
  "NEXT_PUBLIC_API_BASE_URL",
  "NEXT_PUBLIC_AUTH_MODE",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

export function productionWebEnvironmentFailures(environment: WebEnvironment): string[] {
  if (!requiresProductionWebConfiguration(environment)) return [];

  const failures: string[] = [];
  for (const name of requiredWebVariables) {
    if (!environment[name]?.trim()) failures.push(`${name} is required`);
  }

  if (environment.APP_ENV && environment.APP_ENV !== "production") {
    failures.push("APP_ENV must be production");
  }
  if (environment.LDG_PROCESS && environment.LDG_PROCESS !== "web") {
    failures.push("LDG_PROCESS must be web");
  }
  if (environment.NEXT_PUBLIC_AUTH_MODE && environment.NEXT_PUBLIC_AUTH_MODE !== "supabase") {
    failures.push("NEXT_PUBLIC_AUTH_MODE must be supabase");
  }

  validateHttpsOrigin("NEXT_PUBLIC_API_BASE_URL", environment.NEXT_PUBLIC_API_BASE_URL, failures);
  validateHttpsOrigin("NEXT_PUBLIC_SUPABASE_URL", environment.NEXT_PUBLIC_SUPABASE_URL, failures);

  const publishableKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (publishableKey && !publishableKey.startsWith("sb_publishable_")) {
    failures.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key");
  }

  return failures;
}

export function assertProductionWebEnvironment(environment: WebEnvironment): void {
  const failures = productionWebEnvironmentFailures(environment);
  if (failures.length === 0) return;

  throw new Error(
    `Production web environment validation failed:\n${failures
      .map((failure) => `- ${failure}`)
      .join("\n")}`,
  );
}

function requiresProductionWebConfiguration(environment: WebEnvironment): boolean {
  return environment.VERCEL_ENV === "production" || environment.APP_ENV === "production";
}

function validateHttpsOrigin(name: string, value: string | undefined, failures: string[]): void {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") failures.push(`${name} must use HTTPS`);
    if (url.username || url.password) failures.push(`${name} must not contain credentials`);
    if (url.pathname !== "/" || url.search || url.hash) {
      failures.push(`${name} must be an origin without a path, query, or fragment`);
    }
  } catch {
    failures.push(`${name} must be a valid URL`);
  }
}
