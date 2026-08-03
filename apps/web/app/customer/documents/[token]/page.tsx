import { LockKeyhole } from "lucide-react";
import type { Metadata } from "next";

import { Brand } from "../../../../components/brand";
import { PublicDocumentCard } from "../../../../components/public-document-card";

export const metadata: Metadata = {
  description: "Secure customer document from Lincoln Dirt & Gravel.",
  robots: { follow: false, index: false },
  title: "Secure document",
};

export default async function CustomerDocumentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <div className="customer-shell">
      <header className="customer-header">
        <Brand />
        <span>
          <LockKeyhole size={14} /> Secure customer portal
        </span>
      </header>
      <main className="customer-main">
        <PublicDocumentCard token={token} />
      </main>
      <footer className="customer-footer">
        <span>© 2026 Lincoln Dirt &amp; Gravel</span>
        <span>Lincoln, Nebraska</span>
      </footer>
    </div>
  );
}
