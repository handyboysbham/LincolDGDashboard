import {
  CalendarDays,
  FileText,
  Inbox,
  Receipt,
  Settings,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StaffShell } from "../../components/staff-shell";

interface SectionDefinition {
  description: string;
  icon: LucideIcon;
  label: string;
}

const sections: Record<string, SectionDefinition> = {
  billing: {
    description:
      "Invoices, payments, credits, and refunds will appear here as their workflows are enabled.",
    icon: Receipt,
    label: "Billing",
  },
  customers: {
    description:
      "Customer accounts, contacts, and service locations arrive with the intake sprint.",
    icon: Users,
    label: "Customers",
  },
  documents: {
    description:
      "Validated files will collect here as they are connected to customers, jobs, and invoices.",
    icon: FileText,
    label: "Documents",
  },
  inbox: {
    description: "Customer messages and operational notifications will be organized here.",
    icon: Inbox,
    label: "Inbox",
  },
  jobs: {
    description: "Delivery and rental jobs will appear once accepted work enters operations.",
    icon: Truck,
    label: "Jobs",
  },
  schedule: {
    description: "Assigned jobs, crews, and equipment will build the shared operating calendar.",
    icon: CalendarDays,
    label: "Schedule",
  },
  settings: {
    description: "Organization, user, role, and workflow settings will be managed here.",
    icon: Settings,
    label: "Settings",
  },
};

interface StaffSectionPageProps {
  params: Promise<{ section: string }>;
}

export async function generateMetadata({ params }: StaffSectionPageProps): Promise<Metadata> {
  const definition = sections[(await params).section];

  return { title: definition?.label ?? "Not found" };
}

export default async function StaffSectionPage({ params }: StaffSectionPageProps) {
  const { section } = await params;
  const definition = sections[section];

  if (!definition) {
    notFound();
  }

  const Icon = definition.icon;

  return (
    <StaffShell active={`/${section}`}>
      <div className="staff-empty-page">
        <span className="page-eyebrow">Workspace</span>
        <h1>{definition.label}</h1>
        <section className="staff-empty-state">
          <span>
            <Icon aria-hidden="true" size={24} strokeWidth={1.8} />
          </span>
          <h2>No records yet</h2>
          <p>{definition.description}</p>
          <small>This workspace is ready for its domain sprint.</small>
        </section>
      </div>
    </StaffShell>
  );
}
