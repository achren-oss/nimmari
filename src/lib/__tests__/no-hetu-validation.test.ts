import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Product decision: hetu fields accept any non-empty value (no format/checksum check).
describe("no hetu validation on signing", () => {
  for (const f of [
    "src/app/api/sign/[token]/route.ts",
    "src/components/SignerView.tsx",
    "src/components/HtmlSignerView.tsx",
  ]) {
    it(`${f} does not validate hetu`, () => {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src).not.toMatch(/validateHetu|Invalid henkilötunnus/);
    });
  }
});
