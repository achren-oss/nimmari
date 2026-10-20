export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NIMMARI_WEBHOOK_WORKER === "1") {
    const { processDeliveries } = await import("./lib/webhook-outbox");
    const timer = setInterval(() => { void processDeliveries().catch(() => undefined); }, 15000);
    timer.unref();
  }
}
