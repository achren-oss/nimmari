export function fieldEditingError(status: string, hasSigned: boolean): string | null {
  if (hasSigned) return "A signer has already signed this document. Cancel it and send a new version to change fields.";
  if (status === "draft" || status === "sent") return null;
  return "This document cannot be edited because it is completed, cancelled or declined.";
}
