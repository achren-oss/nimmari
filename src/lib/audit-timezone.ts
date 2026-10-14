const DEFAULT_TZ = "Europe/Helsinki";

/** Deployment default; overridden per document when `auditTimezone` is set. */
export function defaultAuditTimezone(): string {
  return process.env.PUUMERKKI_AUDIT_TIMEZONE?.trim() || DEFAULT_TZ;
}

export function resolveAuditTimezone(documentTimezone: string | null | undefined): string {
  const candidate = (documentTimezone?.trim() || defaultAuditTimezone()).trim();
  if (!candidate) return DEFAULT_TZ;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_TZ;
  }
}

/** `YYYY-MM-DD HH:mm` in the given IANA zone, with zone label (not UTC). */
export function formatAuditTimestamp(d: Date, timeZone: string): string {
  const tz = resolveAuditTimezone(timeZone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const date = `${pick("year")}-${pick("month")}-${pick("day")}`;
  const time = `${pick("hour")}:${pick("minute")}`;
  return `${date} ${time} ${tz}`;
}
