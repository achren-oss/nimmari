import type { field } from "@/db/schema";
import { fieldMatchesSigner } from "./signer-assignment";
type DbField = typeof field.$inferSelect;

/** Fields a given signer may see and submit. */
export function fieldsVisibleToSigner(fields: DbField[], signerEmail: string, signerKey?: string | null): DbField[] {
  return fields.filter((f) => fieldMatchesSigner(f, { recipientEmail: signerEmail, signerKey }));
}
