import type { Metadata } from "next";

import { QuoteDetail } from "../../../components/quote-detail";
import { StaffShell } from "../../../components/staff-shell";

export const metadata: Metadata = { title: "Quote" };

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <StaffShell active="/quotes">
      <QuoteDetail quoteId={(await params).id} />
    </StaffShell>
  );
}
