import crypto from "crypto";

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
export function isSafeWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Only allow HTTP/HTTPS
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    // Block private/internal IP ranges
    const hostname = parsed.hostname.toLowerCase();

    // Block localhost
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.startsWith("127.") ||
      hostname === "0.0.0.0"
    ) {
      return false;
    }

    // Block private IPv4 ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x)
    const ipv4Private = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;
    if (ipv4Private.test(hostname)) {
      return false;
    }

    // Block link-local addresses
    if (hostname.startsWith("169.254.")) {
      return false;
    }

    // Block IPv6 private ranges
    if (
      hostname.startsWith("fc00:") ||
      hostname.startsWith("fd00:") ||
      hostname.startsWith("fe80:")
    ) {
      return false;
    }

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
): Promise<{ success: boolean; error?: string }> {
  // Validate URL safety
  if (!isSafeWebhookUrl(url)) {
    return { success: false, error: "Webhook URL is not allowed (SSRF protection)" };
  }

  const payloadStr = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Nimmari-Webhook/1.0",
  };

  // Add HMAC signature if secret is provided
  if (secret) {
    headers["X-Puumerkki-Signature"] = generateWebhookSignature(payloadStr, secret);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: payloadStr,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        error: `Webhook returned ${response.status}: ${response.statusText}`,
      };
    }

    return { success: true };
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
