import type { Metadata } from "next";

import { RefundDetail } from "../../../../components/refund-detail";
import { StaffShell } from "../../../../components/staff-shell";

export const metadata: Metadata = { title: "Refund" };

export default async function RefundPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <StaffShell active="/billing">
      <RefundDetail refundId={(await params).id} />
    </StaffShell>
  );
}
