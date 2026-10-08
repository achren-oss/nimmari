import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

const { sendSigningEmail } = await import("../email");
const args = { to: "s@example.com", senderName: "Owner", documentTitle: "Doc", url: "https://x/sign/t" };

describe("sendSigningEmail", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM = "from@example.com";
    send.mockReset();
  });
  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
  });

  it("reports success", async () => {
    send.mockResolvedValue({ data: { id: "e1" }, error: null });
    expect(await sendSigningEmail(args)).toEqual({ sent: true });
  });
  it("reports an API error returned by the SDK as not sent", async () => {
    send.mockResolvedValue({ data: null, error: { message: "API key is invalid", name: "validation_error" } });
    expect(await sendSigningEmail(args)).toEqual({ sent: false, note: "API key is invalid" });
  });
  it("reports a thrown error as not sent", async () => {
    send.mockRejectedValue(new Error("network down"));
    expect(await sendSigningEmail(args)).toEqual({ sent: false, note: "network down" });
  });
  it("skips sending when Resend is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    const r = await sendSigningEmail(args);
    expect(r.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
