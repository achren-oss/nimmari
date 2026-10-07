import { NextResponse } from "next/server";
import { getApiIdentity } from "@/lib/api-auth";
import { renderHtmlToPdf } from "@/lib/render-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Operator self-check: renders a tiny HTML page with Chromium and reports
// timing or the launch/render error. Service-account bearer key only.
export async function GET(req: Request) {
  const who = await getApiIdentity(req);
  if (!who || who.via !== "bot") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const t0 = Date.now();
  try {
    const pdf = await renderHtmlToPdf("<html><body><p>Puumerkki PDF self-check</p></body></html>");
    return NextResponse.json({ status: "ok", ms: Date.now() - t0, bytes: pdf.length });
  } catch (e) {
    const err = e as Error;
    return NextResponse.json(
      { status: "error", ms: Date.now() - t0, error: String(err?.message ?? e).slice(0, 2000) },
      { status: 500 },
    );
  }
}
