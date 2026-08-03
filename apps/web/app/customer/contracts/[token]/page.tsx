import type { Metadata } from "next";
import { Brand } from "../../../../components/brand";
import { PublicContractCard } from "../../../../components/public-contract-card";
export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Secure Contract",
};
export default async function PublicContractPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="customer-portal">
      <header className="customer-portal-header">
        <Brand />
        <span>Secure customer portal</span>
      </header>
      <PublicContractCard token={token} />
      <footer>Lincoln Dirt &amp; Gravel · Private agreement link</footer>
    </main>
  );
}
