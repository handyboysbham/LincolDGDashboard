import { LockKeyhole } from "lucide-react";
import type { Metadata } from "next";

import { Brand } from "../../../../components/brand";
import { PublicProjectCard } from "../../../../components/public-project-card";

export const metadata: Metadata = {
  description: "Secure project summary from Lincoln Dirt & Gravel.",
  robots: { follow: false, index: false },
  title: "Your Project",
};

export default async function CustomerProjectPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return (
    <div className="customer-shell">
      <header className="customer-header">
        <Brand />
        <span>
          <LockKeyhole aria-hidden="true" size={14} /> Secure customer portal
        </span>
      </header>
      <main className="customer-main customer-project-main">
        <PublicProjectCard token={(await params).token} />
      </main>
      <footer className="customer-footer">
        <span>© 2026 Lincoln Dirt &amp; Gravel</span>
        <span>Lincoln, Nebraska</span>
      </footer>
    </div>
  );
}
