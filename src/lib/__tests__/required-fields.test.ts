import { describe, expect, it } from "vitest";
import { missingRequiredFields, requiredForSigner, shortFieldLabel } from "../required-fields";

const fields = [
  { id: "a", type: "text" as const, label: "Ostaja: sukunimi", required: true, prefilled: true },
  { id: "b", type: "hetu" as const, label: "Ostaja: henkilötunnus", required: true },
  { id: "c", type: "text" as const, label: "Ostaja: lähiosoite", required: true },
  { id: "d", type: "text" as const, label: "Lisätieto", required: false },
  { id: "s", type: "signature" as const, label: "Allekirjoitus", required: true },
];

describe("required fields", () => {
  it("excludes prefilled and optional fields", () => {
    expect(requiredForSigner(fields).map((f) => f.id)).toEqual(["b", "c", "s"]);
  });
  it("returns all missing at once, not just the first", () => {
    expect(missingRequiredFields(fields, {}, false).map((f) => f.id)).toEqual(["b", "c", "s"]);
    expect(missingRequiredFields(fields, { b: "x", c: " " }, true).map((f) => f.id)).toEqual(["c"]);
  });
  it("shortens labels", () => {
    expect(shortFieldLabel("Luovutuksen-saaja/ostaja: lähiosoite")).toBe("lähiosoite");
    expect(shortFieldLabel("Allekirjoitus")).toBe("Allekirjoitus");
  });
});
