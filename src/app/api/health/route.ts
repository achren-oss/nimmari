import { scheduleWebhookWork } from "@/lib/webhook-worker";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

// Liveness + database connectivity check for load balancers and Docker.
export async function GET() {
  try {
    await db.run(sql`select 1`);
    scheduleWebhookWork();
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "error", database: "unreachable" }, { status: 503 });
  }
}
