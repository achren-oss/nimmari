import Link from "next/link";
import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { document, field } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { notFound, redirect } from "next/navigation";
import type { EditorField } from "@/components/FieldEditor";
import { FieldEditor } from "@/components/ClientPdf";

export default async function EditDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const [doc] = await db.select().from(document).where(eq(document.id, id));
  if (!doc || doc.ownerId !== user.id) notFound();
  if (doc.kind === "html") {
    redirect(`/documents/${id}`);
  }

  const rows = await db
    .select()
    .from(field)
    .where(eq(field.documentId, id))
    .orderBy(asc(field.page));

  const initialFields: EditorField[] = rows
    .filter((r) => r.page !== null && r.x !== null && r.y !== null && r.width !== null && r.height !== null)
    .map((r) => ({
      id: r.id,
      type: r.type,
      page: r.page!,
      x: r.x!,
      y: r.y!,
      width: r.width!,
      height: r.height!,
      label: r.label ?? undefined,
      required: r.required,
    }));

  return (
    <main className="page-shell">
      <Link href="/dashboard" className="back-link">← The desk</Link>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 24, gap: 16, flexWrap: "wrap" }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>{doc.title}</h1>
        <Link href={`/documents/${id}`} className="btn-secondary">
          Done editing
        </Link>
      </header>
      <FieldEditor documentId={id} initialFields={initialFields} />
    </main>
  );
}
