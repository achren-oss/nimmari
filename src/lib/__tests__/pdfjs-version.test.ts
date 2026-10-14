import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The pdf.js worker (resolved from the top-level pdfjs-dist) must match the
// pdf.js API version react-pdf bundles, or the viewer fails with
// "Failed to load PDF file." (regression from #13).
describe("pdfjs-dist version", () => {
  it("matches react-pdf's pdfjs-dist dependency", () => {
    const root = process.cwd();
    const reactPdf = JSON.parse(
      readFileSync(join(root, "node_modules/react-pdf/package.json"), "utf8"),
    );
    const installed = JSON.parse(
      readFileSync(join(root, "node_modules/pdfjs-dist/package.json"), "utf8"),
    ).version;
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const wanted = String(reactPdf.dependencies["pdfjs-dist"]).replace(/^[\^~]/, "");
    expect(installed).toBe(wanted);
    expect(String(pkg.dependencies?.["pdfjs-dist"] ?? pkg.devDependencies?.["pdfjs-dist"]).replace(/^[\^~]/, "")).toBe(wanted);
  });
});
