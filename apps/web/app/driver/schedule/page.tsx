import type { Metadata } from "next";

import { DriverShell } from "../../../components/driver-shell";
import { DriverWorkspace } from "../../../components/driver-workspace";

export const metadata: Metadata = { title: "Driver schedule" };

export default function DriverSchedulePage() {
  return (
    <DriverShell active="/driver/schedule">
      <DriverWorkspace view="schedule" />
    </DriverShell>
  );
}
