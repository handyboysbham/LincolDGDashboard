import type { Metadata } from "next";
import { DriverShell } from "../../components/driver-shell";
import { DriverWorkspace } from "../../components/driver-workspace";

export const metadata: Metadata = { title: "Driver workspace" };

export default function DriverPage() {
  return (
    <DriverShell active="/driver">
      <DriverWorkspace />
    </DriverShell>
  );
}
