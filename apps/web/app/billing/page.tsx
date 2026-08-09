import type { Metadata } from "next";

import { BillingWorkspace } from "../../components/billing-workspace";
import { StaffShell } from "../../components/staff-shell";

export const metadata: Metadata = { title: "Billing" };

export default function BillingPage() {
  return (
    <StaffShell active="/billing">
      <BillingWorkspace />
    </StaffShell>
  );
}
