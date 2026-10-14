import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { document, signingSession } from "@/db/schema";
import { stopDocument, stoppedDocumentResponse } from "@/lib/document-stop";
import { signRateLimit } from "@/lib/rate-limit";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const limited = signRateLimit(req);
  if (limited) return limited;
  const { token } = await params;
  const [s] = await db.select().from(signingSession).where(eq(signingSession.token, token));
  if (!s) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  const [doc] = await db.select().from(document).where(eq(document.id, s.documentId));
  if (!doc) return NextResponse.json({ error: "Document missing" }, { status: 404 });
  const stopped = stoppedDocumentResponse(doc.status);
  if (stopped) return stopped;
  if (s.expiresAt < new Date()) return NextResponse.json({ error: "Link expired" }, { status: 410 });
  const parsed = z.object({ reason: z.string().max(1000).optional() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const result = await stopDocument(doc.id, "declined", parsed.data.reason ?? null, s.id);
  return result ? NextResponse.json({ ok: true, status: "declined" }) : NextResponse.json({ error: "Document cannot be declined" }, { status: 409 });
}
