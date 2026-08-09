import type { Metadata } from "next";

import { InvoiceDetail } from "../../../../components/invoice-detail";
import { StaffShell } from "../../../../components/staff-shell";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <StaffShell active="/billing">
      <InvoiceDetail invoiceId={(await params).id} />
    </StaffShell>
  );
}
