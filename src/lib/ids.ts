import { randomBytes } from "crypto";

export function id(prefix = "") {
  const s = randomBytes(12).toString("base64url");
  return prefix ? `${prefix}_${s}` : s;
}

export function token() {
  return randomBytes(24).toString("base64url");
}
