/** Make audit strings safe for pdf-lib StandardFonts (WinAnsi). */
export function pdfAuditText(s: string): string {
  return s
    .replace(/\u2026/g, "...")
    .replace(/\u00b7/g, "-")
    .replace(/[^\u0000-\u00ff]/g, "?");
}
