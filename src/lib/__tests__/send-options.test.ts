import { describe, expect, it } from "vitest";
import { SendBody } from "../send-options";
import { FieldsBody } from "../field-schema";

describe("send body", () => {
  it("defaults notify to true (email delivery unchanged)", () => {
    const r = SendBody.parse({ email: "a@example.com" });
    expect(r.notify).toBe(true);
  });
  it("accepts notify: false for link-only delivery", () => {
    const r = SendBody.parse({ email: "a@example.com", name: "A", notify: false });
    expect(r.notify).toBe(false);
    expect(r.name).toBe("A");
  });
  it.each([
    { email: "a@example.com", notify: "false" },
    { email: "a@example.com", notify: 0 },
    { email: "not-an-email", notify: false },
    { notify: false },
  ])("rejects invalid input %j", (body) => {
    expect(SendBody.safeParse(body).success).toBe(false);
  });
});

describe("fields body", () => {
  const f = { type: "text", page: 0, x: 10, y: 20, width: 100, height: 20 };
  it("accepts fields and defaults required to true", () => {
    const r = FieldsBody.parse({ fields: [f, { ...f, type: "signature", required: false }] });
    expect(r.fields[0].required).toBe(true);
    expect(r.fields[1].required).toBe(false);
  });
  it("accepts an empty list", () => {
    expect(FieldsBody.parse({ fields: [] }).fields).toEqual([]);
  });
  it("accepts date, hetu, and privacy metadata", () => {
    const r = FieldsBody.parse({
      fields: [
        { ...f, type: "date", name: "start_date" },
        {
          ...f,
          type: "hetu",
          name: "hetu",
          privateForOtherSigners: true,
          assignedToSignerEmail: "signer@example.com",
        },
      ],
    });
    expect(r.fields[0].type).toBe("date");
    expect(r.fields[1].privateForOtherSigners).toBe(true);
  });
  it.each([
    { ...f, type: "invalid" },
    { ...f, width: 5 },
    { ...f, page: -1 },
    { ...f, x: 1.5 },
  ])("rejects invalid field %j", (bad) => {
    expect(FieldsBody.safeParse({ fields: [bad] }).success).toBe(false);
  });
});
