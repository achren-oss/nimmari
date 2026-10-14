import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { extractAcroFormFields } from "../acroform";

const FIXTURE = join(process.cwd(), "scripts/fixtures/acroform-fillable.pdf");

describe("extractAcroFormFields", () => {
  it("imports text, checkbox, dropdown, and radio from a real fillable PDF", async () => {
    const pdfBytes = readFileSync(FIXTURE);
    const result = await extractAcroFormFields(pdfBytes);

    expect(result.errors).toEqual([]);
    expect(result.fields.length).toBeGreaterThanOrEqual(4);

    const byName = new Map(result.fields.map((f) => [f.name, f]));
    expect(byName.get("text_single")?.type).toBe("text");
    expect(byName.get("text_multiline")?.type).toBe("textarea");
    expect(byName.get("check_agree")?.type).toBe("checkbox");

    const dropdown = result.fields.filter((f) => f.name === "dropdown_choice");
    expect(dropdown.length).toBeGreaterThan(0);
    expect(dropdown[0].type).toBe("text");
    expect(result.warnings.some((w) => w.includes("dropdown_choice"))).toBe(true);

    const radio = result.fields.filter((f) => f.name === "radio_pick");
    expect(radio.length).toBeGreaterThan(0);
    expect(radio[0].type).toBe("text");
    expect(result.warnings.some((w) => w.includes("radio_pick"))).toBe(true);

    for (const f of result.fields) {
      expect(f.page).toBe(0);
      expect(f.width).toBeGreaterThan(0);
      expect(f.height).toBeGreaterThan(0);
    }
  });
});
