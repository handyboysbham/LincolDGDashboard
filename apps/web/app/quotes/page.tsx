import type { Metadata } from "next";

import { QuoteWorkspace } from "../../components/quote-workspace";
import { StaffShell } from "../../components/staff-shell";

export const metadata: Metadata = { title: "Quotes" };

export default function QuotesPage() {
  return (
    <StaffShell active="/quotes">
      <QuoteWorkspace />
    </StaffShell>
  );
}
