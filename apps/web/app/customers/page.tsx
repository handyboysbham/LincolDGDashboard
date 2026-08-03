import type { Metadata } from "next";

import { CustomerWorkspace } from "../../components/customer-workspace";
import { StaffShell } from "../../components/staff-shell";

export const metadata: Metadata = { title: "Customers" };

export default function CustomersPage() {
  return (
    <StaffShell active="/customers">
      <CustomerWorkspace />
    </StaffShell>
  );
}
