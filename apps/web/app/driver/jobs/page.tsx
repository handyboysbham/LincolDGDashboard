import type { Metadata } from "next";

import { DriverShell } from "../../../components/driver-shell";
import { DriverWorkspace } from "../../../components/driver-workspace";

export const metadata: Metadata = { title: "Driver jobs" };

export default function DriverJobsPage() {
  return (
    <DriverShell active="/driver/jobs">
      <DriverWorkspace view="jobs" />
    </DriverShell>
  );
}
