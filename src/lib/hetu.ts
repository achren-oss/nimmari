/**
 * Validates a Finnish henkilötunnus (personal identity code) with checksum validation.
 * Format: DDMMYYZNNNC (11 characters total)
 * where Z is the century marker: + (1800s), - (1900s), A-Y (2000s+)
 *
 * Examples:
 * - 010190-123A: born Jan 1, 1990 (dash is the century marker for 1900s)
 * - 010100A123N: born Jan 1, 2000 (A is the century marker for 2000s)
 */

const CHECKSUM_CHARS = "0123456789ABCDEFHJKLMNPRSTUVWXY";
const CENTURY_MARKERS = ["+", "-", "A", "B", "C", "D", "E", "F", "U", "V", "W", "X", "Y"];

function centuryYear(marker: string, yy: number): number | null {
  if (marker === "+") return 1800 + yy;
  if (marker === "-") return 1900 + yy;
  if (marker >= "A" && marker <= "Y") {
    // A → 2000–2099, B → 2100–2199, …
    const offset = marker.charCodeAt(0) - "A".charCodeAt(0);
    return 2000 + offset * 100 + yy;
  }
  return null;
}

export function validateHetu(hetu: string): boolean {
  if (typeof hetu !== "string") return false;

  // Normalize: trim and uppercase
  hetu = hetu.trim().toUpperCase();

  // Must be exactly 11 characters
  if (hetu.length !== 11) return false;

  // Extract parts: DDMMYYZNNNC
  const day = hetu.substring(0, 2);
  const month = hetu.substring(2, 4);
  const year = hetu.substring(4, 6);
  const centuryMarker = hetu.charAt(6);
  const individual = hetu.substring(7, 10);
  const checksum = hetu.charAt(10);

  // Validate century marker
  if (!CENTURY_MARKERS.includes(centuryMarker)) return false;

  // Validate numeric parts
  if (!/^\d{2}$/.test(day)) return false;
  if (!/^\d{2}$/.test(month)) return false;
  if (!/^\d{2}$/.test(year)) return false;
  if (!/^\d{3}$/.test(individual)) return false;

  const dayNum = parseInt(day, 10);
  const monthNum = parseInt(month, 10);
  const yearNum = parseInt(year, 10);
  if (dayNum < 1 || dayNum > 31) return false;
  if (monthNum < 1 || monthNum > 12) return false;

  const fullYear = centuryYear(centuryMarker, yearNum);
  if (fullYear === null) return false;
  const cal = new Date(Date.UTC(fullYear, monthNum - 1, dayNum));
  if (
    cal.getUTCFullYear() !== fullYear ||
    cal.getUTCMonth() !== monthNum - 1 ||
    cal.getUTCDate() !== dayNum
  ) {
    return false;
  }

  // Calculate checksum: (DDMMYYNNN % 31) maps to CHECKSUM_CHARS
  const numericPart = day + month + year + individual;
  const num = parseInt(numericPart, 10);
  const remainder = num % 31;
  const expectedChecksum = CHECKSUM_CHARS[remainder];

  return checksum === expectedChecksum;
}

/**
 * Formats a hetu for display. Since the format is already compact (11 chars),
 * this returns it as-is. The dash in "010190-123A" is the century marker, not a separator.
 */
export function formatHetu(hetu: string): string {
  // Hetus are already in their canonical form
  return hetu;
}

/**
 * Masks a hetu for display to other signers: shows only the last 4 characters.
 * Example: 010190-123A → *******123A
 */
export function maskHetu(hetu: string): string {
  if (hetu.length <= 4) return hetu;
  return "*".repeat(hetu.length - 4) + hetu.slice(-4);
}
