import type { Metadata } from "next";

import { AdministrationWorkspace } from "../../components/administration-workspace";
import { StaffShell } from "../../components/staff-shell";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <StaffShell active="/settings">
      <AdministrationWorkspace />
    </StaffShell>
  );
}
