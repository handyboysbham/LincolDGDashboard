import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const rootEnvironment = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(rootEnvironment)) process.loadEnvFile(rootEnvironment);
process.env.NEXT_TELEMETRY_DISABLED ??= "1";

const nextConfig: NextConfig = {
  headers: () =>
    Promise.resolve([
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
