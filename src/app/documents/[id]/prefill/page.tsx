import Link from "next/link";
import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { document, field } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { notFound, redirect } from "next/navigation";
import { fillHtml } from "@/lib/html-form";
import { PrefillView } from "@/components/PrefillView";

export default async function PrefillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const [doc] = await db.select().from(document).where(eq(document.id, id));
  if (!doc || doc.ownerId !== user.id) notFound();
  if (doc.kind !== "html") redirect(`/documents/${id}`);
  if (doc.status === "completed") redirect(`/documents/${id}`);
  if (!doc.htmlSource) notFound();
  const alreadySent = doc.status === "sent";

  const fields = await db
    .select()
    .from(field)
    .where(eq(field.documentId, id))
    .orderBy(asc(field.id));

  const existingValues: Record<string, string> = {};
  for (const f of fields) {
    if (f.prefilled && f.name && f.value !== null) {
      existingValues[f.name] = f.value;
    }
  }

  // Bake any previously pre-filled values into the iframe content so the
  // owner can resume editing where they left off. Don't disable anything —
  // the owner is editing, not signing.
  const seedHtml = fillHtml(doc.htmlSource, existingValues, null, { disableMode: "filled-only" });
  // Then strip every "disabled" attribute we just added so all fields stay editable.
  const editableHtml = seedHtml.replace(/\s+disabled(="[^"]*")?/g, "");

  return (
    <main className="page-shell">
      <Link href={`/documents/${id}`} className="back-link">← Back to document</Link>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 24, gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 0 }}>Pre-fill <strong>{doc.title}</strong></h1>
          <p style={{ marginTop: 6, color: "var(--ink-soft)", fontStyle: "italic", fontSize: 14 }}>
            Type values into any fields you want locked before sending. Leave the rest empty for the recipient to fill.
          </p>
        </div>
      </header>
      {alreadySent && (
        <div style={{ marginBottom: 20, padding: "10px 14px", background: "rgba(184,138,44,0.10)", border: "1px solid rgba(184,138,44,0.35)", borderRadius: 4, color: "var(--ink)", fontSize: 13, fontStyle: "italic" }}>
          The signing link is already out. Edits apply on the next page load — if the recipient is mid-form, they keep what they&rsquo;ve typed.
        </div>
      )}

      <PrefillView documentId={id} htmlSource={editableHtml} />
    </main>
  );
}
