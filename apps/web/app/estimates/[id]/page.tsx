import type { Metadata } from "next";

import { EstimateDetail } from "../../../components/estimate-detail";
import { StaffShell } from "../../../components/staff-shell";

export const metadata: Metadata = { title: "Estimate" };

export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <StaffShell active="/estimates">
      <EstimateDetail estimateVersionId={(await params).id} />
    </StaffShell>
  );
}
