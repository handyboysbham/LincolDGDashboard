import type { Metadata } from "next";

import { DriverShell } from "../../../components/driver-shell";
import { DriverWorkspace } from "../../../components/driver-workspace";

export const metadata: Metadata = { title: "Driver route" };

export default function DriverRoutePage() {
  return (
    <DriverShell active="/driver/route">
      <DriverWorkspace view="route" />
    </DriverShell>
  );
}
