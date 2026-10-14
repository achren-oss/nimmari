import { describe, expect, it } from "vitest";
import { signDoneMessage, signDoneUrl } from "../sign-done";

describe("done page notification text", () => {
  it.each([false, true])("carries independent actual send outcomes (copy=%s)", (copy) => {
    for (const sender of [false, true]) {
      const url = signDoneUrl("token", { copyEmailSent: copy, senderEmailSent: sender });
      const query = Object.fromEntries(new URL(url, "http://localhost").searchParams);
      const text = signDoneMessage(query);
      expect(text).toContain("Your signature has been recorded.");
      expect(text.includes("inbox")).toBe(copy);
      expect(text.includes("sender has been notified")).toBe(sender);
    }
  });

  it("defaults absent or malformed flags to neutral text", () => {
    expect(signDoneMessage({})).toBe("Your signature has been recorded.");
    expect(signDoneMessage({ copyEmailSent: "true", senderEmailSent: ["1", "0"] }))
      .toBe("Your signature has been recorded.");
    expect(signDoneUrl("token", {})).toBe("/sign/token/done");
  });
});
