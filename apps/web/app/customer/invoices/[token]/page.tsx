import { LockKeyhole } from "lucide-react";
import type { Metadata } from "next";

import { Brand } from "../../../../components/brand";
import { PublicInvoiceCard } from "../../../../components/public-invoice-card";

export const metadata: Metadata = {
  description: "Secure customer Invoice from Lincoln Dirt & Gravel.",
  robots: { follow: false, index: false },
  title: "Secure Invoice",
};

export default async function CustomerInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return (
    <div className="customer-shell">
      <header className="customer-header">
        <Brand />
        <span>
          <LockKeyhole size={14} /> Secure customer portal
        </span>
      </header>
      <main className="customer-main public-quote-main">
        <PublicInvoiceCard token={(await params).token} />
      </main>
      <footer className="customer-footer">
        <span>© 2026 Lincoln Dirt &amp; Gravel</span>
        <span>Lincoln, Nebraska</span>
      </footer>
    </div>
  );
}
