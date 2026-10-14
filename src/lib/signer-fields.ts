import type { field } from "@/db/schema";
import { fieldsVisibleToSigner } from "@/lib/field-visibility";

type DbField = typeof field.$inferSelect;

export type SignerFieldDto = {
  id: string;
  type: DbField["type"];
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  required: boolean;
  prefilled: boolean;
  value: string | null;
  readOnly: boolean;
  assignedSignerKey?: string | null;
  assignedToSignerEmail?: string | null;
};

export function buildSignerFieldPayload(
  fields: DbField[],
  signerEmail: string,
  signerKey?: string | null,
): SignerFieldDto[] {
  return fieldsVisibleToSigner(fields, signerEmail, signerKey)
    .filter(
      (f) =>
        f.page !== null &&
        f.x !== null &&
        f.y !== null &&
        f.width !== null &&
        f.height !== null,
    )
    .map((f) => ({
      id: f.id,
      type: f.type,
      page: f.page!,
      x: f.x!,
      y: f.y!,
      width: f.width!,
      height: f.height!,
      label: f.label ?? undefined,
      required: f.required,
      prefilled: f.prefilled,
      value: f.prefilled ? f.value : null,
      readOnly: f.prefilled,
      assignedSignerKey: f.assignedSignerKey,
      assignedToSignerEmail: f.assignedToSignerEmail,
    }));
}

export function initialSignerValues(dtos: SignerFieldDto[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of dtos) {
    if (f.prefilled && f.value !== null) {
      out[f.id] = f.value;
    }
  }
  return out;
}
