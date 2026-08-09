export type InvoiceVersionAction = "post" | "prepare";
export type RefundAction = "approve" | "cancel" | "process" | "reverse" | "settle";

export function parseMoneyInputToCents(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) return undefined;
  const [dollars = "0", fraction = ""] = normalized.split(".");
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : undefined;
}

export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function invoiceVersionAction(status: string): InvoiceVersionAction | undefined {
  if (status === "draft") return "prepare";
  if (status === "ready_to_post") return "post";
  return undefined;
}

export function refundAction(status: string): RefundAction | undefined {
  if (["draft", "pending_approval", "review_required"].includes(status)) return "approve";
  if (status === "approved") return "process";
  if (["partially_processed", "processed", "processing"].includes(status)) return "settle";
  if (status === "settled") return "reverse";
  return undefined;
}

export function actionLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}
