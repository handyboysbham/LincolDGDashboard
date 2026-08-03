import type { Metadata } from "next";

import { LeadDetail } from "../../../components/lead-detail";
import { StaffShell } from "../../../components/staff-shell";

interface LeadPageProps {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = { title: "Lead" };

export default async function LeadPage({ params }: LeadPageProps) {
  return (
    <StaffShell active="/leads">
      <LeadDetail leadId={(await params).id} />
    </StaffShell>
  );
}
