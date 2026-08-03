export function normalizeCustomerName(value: string): string {
  return normalizeWords(value);
}

export function normalizeEmail(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized === "" ? undefined : normalized;
}

export function normalizePhone(value: string | undefined): string | undefined {
  const digits = value?.replaceAll(/\D/g, "") ?? "";
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits === "" ? undefined : digits;
}

export function normalizeAddress(input: {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  postalCode: string;
  region: string;
}): string {
  return normalizeWords(
    [input.addressLine1, input.addressLine2, input.city, input.region, input.postalCode]
      .filter((value): value is string => Boolean(value))
      .join(" "),
  );
}

function normalizeWords(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim()
    .replaceAll(/\s+/g, " ");
}
