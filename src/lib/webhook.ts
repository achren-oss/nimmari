import { BlockList, isIP } from "node:net";
import { nimmariEnv } from "./env";
import crypto from "crypto";

const blockedAddresses = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) blockedAddresses.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) blockedAddresses.addSubnet(address, prefix, "ipv6");

/**
 * Generate HMAC signature for webhook payload
 */
export function generateWebhookSignature(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Verify webhook signature
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expected = generateWebhookSignature(payload, secret);
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/**
 * Check if a URL is safe to make requests to (prevent SSRF)
 */
export function isSafeWebhookUrl(url: string, existing = false): boolean {
  try {
    const parsed = new URL(url);

    // Only allow HTTP/HTTPS
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    if (parsed.username || parsed.password) return false;
    if (nimmariEnv("WEBHOOK_ALLOW_PRIVATE") === "1") return true;

    if (!existing && process.env.NODE_ENV === "production" && parsed.protocol !== "https:") return false;

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    const family = isIP(hostname);
    if (family && blockedAddresses.check(hostname, family === 6 ? "ipv6" : "ipv4")) return false;
    if (hostname === "localhost") return false;

    // Block special domains
    const blockedDomains = [
      ".local",
      ".localhost",
      ".internal",
      ".private",
      "metadata.google.internal",
      "169.254.169.254", // AWS/GCP metadata
    ];

    for (const blocked of blockedDomains) {
      if (hostname.endsWith(blocked) || hostname === blocked.substring(1)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Send webhook with timeout and security checks
 */
export async function sendWebhook(
  url: string,
  payload: object,
  secret?: string,
  delivery?: { deliveryId: string; attempt: number },
): Promise<{ success: boolean; error?: string; statusCode?: number }> {
  // Validate URL safety
  if (!isSafeWebhookUrl(url, true)) {
    return { success: false, error: "Webhook URL is not allowed (SSRF protection)" };
  }

  const payloadStr = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Nimmari-Webhook/1.0",
  };

  if (delivery) {
    headers["X-Nimmari-Delivery-Id"] = delivery.deliveryId;
    headers["X-Nimmari-Attempt"] = String(delivery.attempt);
  }

  // Add HMAC signature if secret is provided
  if (secret) {
    headers["X-Puumerkki-Signature"] = generateWebhookSignature(payloadStr, secret);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    let response;
    try { response = await fetch(url, {
      redirect: "error",
      method: "POST",
      headers,
      body: payloadStr,
      signal: controller.signal,
    }); } finally { clearTimeout(timeoutId); }

    if (!response.ok) {
      return {
        success: false, statusCode: response.status,
        error: `Webhook returned ${response.status}: ${response.statusText}`,
      };
    }

    return { success: true, statusCode: response.status };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return { success: false, error: "Webhook request timed out (10s)" };
      }
      return { success: false, error: `Webhook failed: ${error.message}` };
    }
    return { success: false, error: "Unknown webhook error" };
  }
}
