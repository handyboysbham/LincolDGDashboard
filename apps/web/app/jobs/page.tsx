import type { Metadata } from "next";
import { JobWorkspace } from "../../components/job-workspace";
import { StaffShell } from "../../components/staff-shell";
export const metadata: Metadata = { title: "Jobs" };
export default function JobsPage() {
  return (
    <StaffShell active="/jobs">
      <JobWorkspace />
    </StaffShell>
  );
}
