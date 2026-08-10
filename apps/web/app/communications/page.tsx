import type { Metadata } from "next";

import { CommunicationsWorkspace } from "../../components/communications-workspace";
import { StaffShell } from "../../components/staff-shell";

export const metadata: Metadata = { title: "Communications" };

export default function CommunicationsPage() {
  return (
    <StaffShell active="/communications">
      <CommunicationsWorkspace />
    </StaffShell>
  );
}
