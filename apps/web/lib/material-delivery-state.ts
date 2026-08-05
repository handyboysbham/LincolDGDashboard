export const loadExecutionActions = [
  "ready-for-loading",
  "arrive-supplier",
  "start-loading",
  "mark-loaded",
  "start-transit",
  "arrive-customer",
  "start-unloading",
  "complete-delivery",
  "start-reconciliation",
  "reconcile",
] as const;

export type LoadExecutionAction = (typeof loadExecutionActions)[number];

const nextActionByStatus: Record<string, LoadExecutionAction | undefined> = {
  at_customer: "start-unloading",
  at_supplier: "start-loading",
  delivered: "start-reconciliation",
  en_route: "arrive-customer",
  loaded: "start-transit",
  loading: "mark-loaded",
  partially_delivered: "start-reconciliation",
  planned: "ready-for-loading",
  ready_for_loading: "arrive-supplier",
  reconciling: "reconcile",
  unloading: "complete-delivery",
};

export function nextLoadAction(status: string): LoadExecutionAction | undefined {
  return nextActionByStatus[status];
}

export function loadActionLabel(action: LoadExecutionAction): string {
  const labels: Record<LoadExecutionAction, string> = {
    "arrive-customer": "I arrived at the customer",
    "arrive-supplier": "I arrived at the supplier",
    "complete-delivery": "Complete delivery",
    "mark-loaded": "Confirm load is loaded",
    "ready-for-loading": "Release load to driver",
    reconcile: "Reconcile load",
    "start-loading": "Start loading",
    "start-reconciliation": "Send to reconciliation",
    "start-transit": "Depart for customer",
    "start-unloading": "Start unloading",
  };
  return labels[action];
}

export function actionReadinessMessage(action: LoadExecutionAction): string | undefined {
  if (action === "mark-loaded")
    return "Record purchased and loaded quantities, attach each supplier ticket, and pass actual-load safety first.";
  if (action === "complete-delivery")
    return "Record delivered and remaining quantities, select a result, and attach placement evidence first.";
  if (action === "reconcile")
    return "Resolve open variances and confirm all required evidence before final reconciliation.";
  return undefined;
}

export function isSupplierStage(status: string): boolean {
  return ["at_supplier", "loading", "loaded"].includes(status);
}

export function isDeliveryStage(status: string): boolean {
  return ["at_customer", "unloading", "delivered", "partially_delivered", "reconciling"].includes(
    status,
  );
}

export function formatQuantity(value: string | null | undefined, unit: string): string {
  return value === null || value === undefined
    ? "—"
    : `${trimDecimal(value)} ${unit.replaceAll("_", " ")}`;
}

export function formatCents(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", { currency: "USD", style: "currency" }).format(value / 100);
}

function trimDecimal(value: string): string {
  return value.includes(".") ? value.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1") : value;
}
