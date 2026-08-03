export type LeadIntakeAction =
  | "start-contacting"
  | "qualify"
  | "start-estimating"
  | "mark-lost"
  | "cancel"
  | "mark-duplicate"
  | "disqualify";

const leadIntakeActions: readonly LeadIntakeAction[] = [
  "start-contacting",
  "qualify",
  "start-estimating",
  "mark-lost",
  "cancel",
  "mark-duplicate",
  "disqualify",
];

const terminalLeadStatuses = [
  "accepted",
  "cancelled",
  "disqualified",
  "duplicate",
  "lost",
] as const;

export function nextLeadAction(
  status: string,
): { action: LeadIntakeAction; label: string } | undefined {
  if (status === "new") return { action: "start-contacting", label: "Start contacting" };
  if (status === "contacting") return { action: "qualify", label: "Qualify Lead" };
  if (status === "qualified") return { action: "start-estimating", label: "Start estimate" };
  return undefined;
}

export function isTerminalLeadStatus(status: string): boolean {
  return terminalLeadStatuses.some((terminalStatus) => terminalStatus === status);
}

export function isLeadIntakeAction(value: string): value is LeadIntakeAction {
  return leadIntakeActions.some((action) => action === value);
}

export function humanizeIntakeValue(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

export function leadTimelineLabel(value: string): string {
  const labels: Record<string, string> = {
    "lead.cancelled": "Lead cancelled",
    "lead.contacting_started": "Contacting started",
    "lead.created": "Lead created",
    "lead.disqualified": "Lead disqualified",
    "lead.document_linked": "Document linked",
    "lead.duplicate_marked": "Marked duplicate",
    "lead.estimating_started": "Estimating started",
    "lead.lost": "Lead marked lost",
    "lead.note_added": "Note added",
    "lead.qualified": "Lead qualified",
    "lead.task_added": "Task added",
    "lead.task_completed": "Task completed",
  };
  return labels[value] ?? humanizeIntakeValue(value.replace("lead.", ""));
}
