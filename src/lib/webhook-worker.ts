import { after } from "next/server";
import { processDeliveries } from "./webhook-outbox";

let lastRun = 0;
/** after() keeps serverless work alive after sending the response. DB leases provide correctness. */
export function scheduleWebhookWork(ownerId?: string) {
  if (Date.now() - lastRun < 15000) return;
  lastRun = Date.now();
  try { after(async () => { await processDeliveries(ownerId).catch(() => undefined); }); }
  catch { /* Outside a Next request (e.g. unit tests). Cron remains available. */ }
}
