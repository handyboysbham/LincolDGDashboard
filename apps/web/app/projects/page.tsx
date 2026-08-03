import type { Metadata } from "next";
import { ProjectWorkspace } from "../../components/project-workspace";
import { StaffShell } from "../../components/staff-shell";
export const metadata: Metadata = { title: "Projects" };
export default function ProjectsPage() {
  return (
    <StaffShell active="/projects">
      <ProjectWorkspace />
    </StaffShell>
  );
}
