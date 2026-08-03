import type { Metadata } from "next";

import { NewLeadForm } from "../../../components/new-lead-form";
import { StaffShell } from "../../../components/staff-shell";

export const metadata: Metadata = { title: "New Lead" };

export default function NewLeadPage() {
  return (
    <StaffShell active="/leads/new">
      <NewLeadForm />
    </StaffShell>
  );
}
