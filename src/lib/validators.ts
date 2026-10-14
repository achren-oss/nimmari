const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SIGNATURE_BYTES = 500 * 1024;

export function isValidSignaturePng(value: unknown): value is string {
  if (typeof value !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)) return false;
  const encoded = value.slice("data:image/png;base64,".length);
  if (/[^A-Za-z0-9+/=]/.test(encoded)) return false;
  if (encoded.length > Math.ceil(MAX_SIGNATURE_BYTES / 3) * 4) return false;
  // Buffer decoding is permissive; reject malformed padding and base64 too.
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return false;
  const bytes = Buffer.from(encoded, "base64");
  return bytes.length <= MAX_SIGNATURE_BYTES && bytes.subarray(0, 8).equals(PNG_MAGIC);
}

/**
 * Validates a date string in ISO 8601 format (YYYY-MM-DD).
 * Also accepts common date formats: DD.MM.YYYY, DD/MM/YYYY, etc.
 * Returns normalized ISO format if valid, null otherwise.
 */
export function validateAndNormalizeDate(value: string): string | null {
  if (!value || typeof value !== "string") return null;
  value = value.trim();

  // Try ISO format first (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(value + "T00:00:00Z");
    if (!isNaN(date.getTime())) {
      // Verify the parsed date matches input (catches invalid dates like 2023-02-30)
      const [year, month, day] = value.split("-").map(Number);
      if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
        return value;
      }
    }
  }

  // Try DD.MM.YYYY or DD/MM/YYYY formats
  const match = value.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (!isNaN(date.getTime()) &&
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day) {
      // Return ISO format
      const mm = String(month).padStart(2, "0");
      const dd = String(day).padStart(2, "0");
      return `${year}-${mm}-${dd}`;
    }
  }

  return null;
}

/**
 * Format an ISO date (YYYY-MM-DD) to Finnish format (d.m.yyyy)
 */
export function formatDateFinnish(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDate;

  const year = match[1];
  const month = parseInt(match[2], 10); // Remove leading zero
  const day = parseInt(match[3], 10); // Remove leading zero

  return `${day}.${month}.${year}`;
}
