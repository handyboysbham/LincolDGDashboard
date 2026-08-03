import type { Metadata } from "next";
import { headers } from "next/headers";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "127.0.0.1:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const metadataBase = new URL(`${protocol}://${host}`);
  const description =
    "Lincoln Dirt and Gravel operations, scheduling, and customer service workspace.";
  return {
    description,
    metadataBase,
    openGraph: {
      description,
      images: [
        {
          alt: "Lincoln Dirt & Gravel operations workspace",
          height: 1024,
          url: "/og.png",
          width: 1951,
        },
      ],
      title: "Lincoln Dirt & Gravel",
      type: "website",
    },
    title: {
      default: "Lincoln Dirt & Gravel",
      template: "%s | Lincoln Dirt & Gravel",
    },
    twitter: {
      card: "summary_large_image",
      description,
      images: ["/og.png"],
      title: "Lincoln Dirt & Gravel",
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
