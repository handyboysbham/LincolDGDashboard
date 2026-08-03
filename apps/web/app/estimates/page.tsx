import type { Metadata } from "next";

import { EstimateWorkspace } from "../../components/estimate-workspace";
import { StaffShell } from "../../components/staff-shell";

export const metadata: Metadata = { title: "Estimates" };

export default function EstimatesPage() {
  return (
    <StaffShell active="/estimates">
      <EstimateWorkspace />
    </StaffShell>
  );
}
