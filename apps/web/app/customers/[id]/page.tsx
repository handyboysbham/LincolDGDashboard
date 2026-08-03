import type { Metadata } from "next";

import { CustomerDetail } from "../../../components/customer-detail";
import { StaffShell } from "../../../components/staff-shell";

interface CustomerPageProps {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: CustomerPageProps) {
  return (
    <StaffShell active="/customers">
      <CustomerDetail customerId={(await params).id} />
    </StaffShell>
  );
}
