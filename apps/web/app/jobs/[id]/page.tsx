import type { Metadata } from "next";
import { JobDetail } from "../../../components/job-detail";
import { StaffShell } from "../../../components/staff-shell";
export const metadata: Metadata = { title: "Job" };
export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <StaffShell active="/jobs">
      <JobDetail jobId={id} />
    </StaffShell>
  );
}
