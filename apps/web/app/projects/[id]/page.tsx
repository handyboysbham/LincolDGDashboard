import type { Metadata } from "next";
import { ProjectDetail } from "../../../components/project-detail";
import { StaffShell } from "../../../components/staff-shell";
export const metadata: Metadata = { title: "Project" };
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <StaffShell active="/projects">
      <ProjectDetail projectId={id} />
    </StaffShell>
  );
}
