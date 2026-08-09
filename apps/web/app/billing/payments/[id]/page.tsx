import type { Metadata } from "next";

import { PaymentDetail } from "../../../../components/payment-detail";
import { StaffShell } from "../../../../components/staff-shell";

export const metadata: Metadata = { title: "Payment" };

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <StaffShell active="/billing">
      <PaymentDetail paymentId={(await params).id} />
    </StaffShell>
  );
}
