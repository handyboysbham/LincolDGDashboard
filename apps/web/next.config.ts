import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

import { assertProductionWebEnvironment } from "./lib/production-environment";

const rootEnvironment = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(rootEnvironment)) process.loadEnvFile(rootEnvironment);
process.env.NEXT_TELEMETRY_DISABLED ??= "1";
assertProductionWebEnvironment(process.env);

const securityHeaders = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  ...(process.env.APP_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  headers: () =>
    Promise.resolve([
      {
        headers: securityHeaders,
        source: "/:path*",
      },
      {
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
        source: "/customer/documents/:path*",
      },
    ]),
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@ldg/api-client"],
};

export default nextConfig;
