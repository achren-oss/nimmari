import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

export function isCompletePdf(bytes: Uint8Array): boolean {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return buffer.subarray(0, 5).toString("ascii") === "%PDF-"
    && buffer.subarray(-2048).includes("%%EOF")
    && buffer.includes("startxref");
}

export function pdfResponse(bytes: Uint8Array, filename: string): NextResponse {
  if (!isCompletePdf(bytes)) {
    console.error("Refusing to serve incomplete PDF", { byteLength: bytes.byteLength });
    return NextResponse.json({ error: "PDF not ready" }, {
      status: 503,
      headers: { "Retry-After": "2", "Cache-Control": "private, no-store" },
    });
  }

  // Snapshot the body so the digest and length describe exactly the served bytes.
  const body = new Uint8Array(bytes);
  const digest = createHash("sha256").update(body).digest();
  const safeFilename = filename.replace(/[^\w\-. ]+/g, "_");
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeFilename}"`,
      "Cache-Control": "private, no-store",
      "Content-Length": String(body.byteLength),
      "X-Content-SHA256": digest.toString("hex"),
      "Repr-Digest": `sha-256=:${digest.toString("base64")}:`,
    },
  });
}
