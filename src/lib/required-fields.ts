export type RequiredCheckField = {
  id: string;
  type: "text" | "textarea" | "checkbox" | "signature" | "date" | "hetu";
  label?: string;
  required: boolean;
  prefilled?: boolean;
  readOnly?: boolean;
};

/** Short label for a field: the text after the last ": " (e.g. "Buyer: address" → "address"). */
export function shortFieldLabel(label: string | undefined): string {
  if (!label) return "";
  const i = label.lastIndexOf(": ");
  return i >= 0 ? label.slice(i + 2) : label;
}

/** Fields the signer must fill or sign themselves (prefilled/locked excluded). */
export function requiredForSigner<T extends RequiredCheckField>(fields: T[]): T[] {
  return fields.filter((f) => f.required && !f.prefilled && !f.readOnly);
}

function isFilled(f: RequiredCheckField, values: Record<string, string>, hasSignature: boolean) {
  if (f.type === "signature") return hasSignature;
  if (f.type === "checkbox") return values[f.id] === "true";
  return !!values[f.id]?.trim();
}

/** All missing required fields at once, in the given (document) order. */
export function missingRequiredFields<T extends RequiredCheckField>(
  fields: T[],
  values: Record<string, string>,
  hasSignature: boolean,
): T[] {
  return requiredForSigner(fields).filter((f) => !isFilled(f, values, hasSignature));
}
