import { nimmariEnv } from "@/lib/env";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function matchesRootKey(key: string): boolean {
  const root = nimmariEnv("API_KEY");
  return !!root && timingSafeEqual(Buffer.from(hashApiKey(key), "hex"), Buffer.from(hashApiKey(root), "hex"));
}

export function generateApiKey() {
  const key = `pmk_${randomBytes(32).toString("base64url")}`;
  return { key, keyHash: hashApiKey(key), keyPrefix: key.slice(0, 8) };
}
