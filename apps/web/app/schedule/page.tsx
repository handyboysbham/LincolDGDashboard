import type { Metadata } from "next";
import { ScheduleWorkspace } from "../../components/schedule-workspace";
import { StaffShell } from "../../components/staff-shell";
export const metadata: Metadata = { title: "Schedule" };
export default function SchedulePage() {
  return (
    <StaffShell active="/schedule">
      <ScheduleWorkspace />
    </StaffShell>
  );
}
