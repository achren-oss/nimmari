import { describe, expect, it } from "vitest";
import {
  firstOrder,
  nextUnsignedSequentialSigner,
  resolveSignerEmailNote,
  shouldInviteOnSend,
} from "../sequential-invites";
import { LINK_ONLY_NOTE } from "../send-options";

describe("sequential invites", () => {
  const signers = [
    { email: "a@x.com", order: 0 },
    { email: "b@x.com", order: 1 },
  ];

  it("invites only the lowest order on send", () => {
    expect(shouldInviteOnSend(signers[0], signers)).toBe(true);
    expect(shouldInviteOnSend(signers[1], signers)).toBe(false);
    expect(firstOrder(signers)).toBe(0);
  });

  it("resolves email notes", () => {
    expect(
      resolveSignerEmailNote({
        effectiveNotify: false,
        invitedNow: true,
        emailSent: false,
      }),
    ).toBe(LINK_ONLY_NOTE);
    expect(
      resolveSignerEmailNote({
        effectiveNotify: true,
        invitedNow: false,
        emailSent: false,
      }),
    ).toContain("queued");
  });

  it("finds next unsigned signer", () => {
    const next = nextUnsignedSequentialSigner([
      {
        id: "1",
        token: "t1",
        recipientEmail: "a@x.com",
        recipientName: null,
        signerOrder: 0,
        signedAt: new Date(),
      },
      {
        id: "2",
        token: "t2",
        recipientEmail: "b@x.com",
        recipientName: null,
        signerOrder: 1,
        signedAt: null,
      },
    ]);
    expect(next?.recipientEmail).toBe("b@x.com");
  });
});
