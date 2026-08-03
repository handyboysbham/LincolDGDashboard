import type { Metadata } from "next";

import { LeadWorkspace } from "../../components/lead-workspace";
import { StaffShell } from "../../components/staff-shell";

export const metadata: Metadata = { title: "Leads" };

export default function LeadsPage() {
  return (
    <StaffShell active="/leads">
      <LeadWorkspace />
    </StaffShell>
  );
}
