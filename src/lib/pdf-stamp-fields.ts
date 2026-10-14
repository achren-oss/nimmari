import { fieldMatchesSigner } from "@/lib/signer-assignment";
import type { field } from "@/db/schema";

type DbField = typeof field.$inferSelect;

export type StampablePdfField = {
  type: DbField["type"];
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  value: string | null;
};

/**
 * Fields to rasterize on this signing pass. Pre-filled values are stamped on the
 * first signing event only (when no prior signer has sealed), so they appear once.
 */
export function buildPdfStampFields(args: {
  fields: DbField[];
  signerEmail: string;
  signerKey?: string | null;
  priorSignedCount: number;
  submittedValues: Record<string, string>;
}): StampablePdfField[] {
  const stampPrefilledNow = args.priorSignedCount === 0;

  return args.fields
    .filter(
      (f) =>
        f.page !== null &&
        f.x !== null &&
        f.y !== null &&
        f.width !== null &&
        f.height !== null,
    )
    .filter((f) => {
      if (f.prefilled) return stampPrefilledNow;
      return fieldMatchesSigner(f, { recipientEmail: args.signerEmail, signerKey: args.signerKey });
    })
    .map((f) => {
      if (f.type === "signature") {
        return {
          type: f.type,
          page: f.page!,
          x: f.x!,
          y: f.y!,
          width: f.width!,
          height: f.height!,
          value: null,
        };
      }
      const value = f.prefilled
        ? f.value
        : args.submittedValues[f.id] ?? null;
      return {
        type: f.type,
        page: f.page!,
        x: f.x!,
        y: f.y!,
        width: f.width!,
        height: f.height!,
        value,
      };
    });
}
