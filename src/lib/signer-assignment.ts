export type SignerIdentity = { recipientEmail: string; signerKey?: string | null };
export type FieldAssignment = { assignedToSignerEmail?: string | null; assignedSignerKey?: string | null };

export function hasSignerAssignment(field: FieldAssignment): boolean {
  return !!(field.assignedSignerKey || field.assignedToSignerEmail);
}

/** Keys take precedence; email-only assignments retain their legacy matching. */
export function fieldMatchesSigner(field: FieldAssignment, signer: SignerIdentity): boolean {
  if (field.assignedSignerKey) return field.assignedSignerKey === signer.signerKey;
  return !field.assignedToSignerEmail || field.assignedToSignerEmail === signer.recipientEmail;
}
