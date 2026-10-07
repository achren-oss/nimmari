import { createHash } from "crypto";

export function sha256Hex(buf: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(buf as Buffer).digest("hex");
}

export function shortHash(hex: string): string {
  if (hex.length < 12) return hex;
  return `${hex.slice(0, 8)}…${hex.slice(-4)}`;
}
