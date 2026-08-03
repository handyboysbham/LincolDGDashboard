import type { Metadata } from "next";

import { PricingWorkspace } from "../../components/pricing-workspace";
import { StaffShell } from "../../components/staff-shell";

export const metadata: Metadata = { title: "Pricing" };

export default function PricingPage() {
  return (
    <StaffShell active="/pricing">
      <PricingWorkspace />
    </StaffShell>
  );
}
