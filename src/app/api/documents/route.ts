import { NextResponse } from "next/server";
import { db } from "@/db";
import { document } from "@/db/schema";
import { getApiIdentity } from "@/lib/api-auth";
import { id } from "@/lib/ids";
import { sha256Hex } from "@/lib/hash";

const MAX_PDF_BYTES = 4 * 1024 * 1024; // 4 MB — under Vercel's 4.5 MB body limit

export async function POST(req: Request) {
  const identity = await getApiIdentity(req);
  if (!identity) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("pdf");
  const title = (form.get("title") as string) || "Untitled";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing PDF" }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "Must be a PDF" }, { status: 400 });
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json(
      { error: `PDF is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 4 MB.` },
      { status: 413 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const contentHash = sha256Hex(buf);
  const docId = id("doc");
  const now = new Date();
  await db.insert(document).values({
    id: docId,
    ownerId: identity.userId,
    title,
    pdf: buf,
    contentHash,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  });

  return NextResponse.json({ id: docId });
}
