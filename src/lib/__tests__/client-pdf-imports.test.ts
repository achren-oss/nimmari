import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Regression: server pages must not import react-pdf components directly
// (pdf.js needs DOMMatrix, which is missing on the server).
describe("PDF components are client-only", () => {
  for (const page of ["src/app/documents/[id]/edit/page.tsx", "src/app/sign/[token]/page.tsx"]) {
    it(page, () => {
      const src = readFileSync(page, "utf8");
      expect(src).not.toMatch(/import \{[^}]*\b(FieldEditor|SignerView)\b[^}]*\} from "@\/components\/(FieldEditor|SignerView)"/);
      expect(src).toContain('@/components/ClientPdf');
    });
  }
});
