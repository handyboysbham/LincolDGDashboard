import type { Metadata } from "next";

import { DriverJob } from "../../../../components/driver-job";
import { DriverShell } from "../../../../components/driver-shell";

export const metadata: Metadata = { title: "Driver delivery" };

export default async function DriverJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <DriverShell active="/driver/jobs">
      <DriverJob jobId={id} />
    </DriverShell>
  );
}
