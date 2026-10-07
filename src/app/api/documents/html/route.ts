import { NextResponse } from "next/server";
import { db } from "@/db";
import { document, field } from "@/db/schema";
import { getApiIdentity } from "@/lib/api-auth";
import { id } from "@/lib/ids";
import { sha256Hex } from "@/lib/hash";
import { sanitizeFormHtml, extractFields, inferTitle } from "@/lib/html-form";

const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2 MB — generous; pure HTML rarely exceeds 100 kB

export async function POST(req: Request) {
  const identity = await getApiIdentity(req);
  if (!identity) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("html");
  const titleInput = (form.get("title") as string)?.trim() ?? "";

  let raw: string;
  if (file instanceof File) {
    if (!file.name.toLowerCase().endsWith(".html") && file.type !== "text/html") {
      return NextResponse.json({ error: "Must be an HTML file" }, { status: 400 });
    }
    if (file.size > MAX_HTML_BYTES) {
      return NextResponse.json(
        { error: `HTML is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 2 MB.` },
        { status: 413 },
      );
    }
    raw = await file.text();
  } else if (typeof form.get("html") === "string") {
    raw = form.get("html") as string;
    if (raw.length > MAX_HTML_BYTES) {
      return NextResponse.json(
        { error: `HTML is too large. Max 2 MB.` },
        { status: 413 },
      );
    }
  } else {
    return NextResponse.json({ error: "Missing HTML" }, { status: 400 });
  }

  const sanitized = sanitizeFormHtml(raw);
  const contentHash = sha256Hex(sanitized);
  const fields = extractFields(sanitized);

  if (fields.length === 0) {
    return NextResponse.json(
      { error: "No data-pm-field attributes found. The form needs at least one fillable field." },
      { status: 400 },
    );
  }

  const title = titleInput || inferTitle(sanitized, file instanceof File ? file.name.replace(/\.html?$/i, "") : "Untitled form");

  const docId = id("doc");
  const now = new Date();

  await db.insert(document).values({
    id: docId,
    ownerId: identity.userId,
    title,
    kind: "html",
    htmlSource: sanitized,
    contentHash,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(field).values(
    fields.map((f) => ({
      id: id("fld"),
      documentId: docId,
      type: f.type === "radio" ? "text" : f.type,
      name: f.name,
      label: f.label,
      required: f.required,
    })),
  );

  return NextResponse.json({ id: docId, fieldCount: fields.length });
}
