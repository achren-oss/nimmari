import Link from "next/link";
import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { document, field, signingSession } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { notFound } from "next/navigation";
import { SendForm } from "@/components/SendForm";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const [doc] = await db.select().from(document).where(eq(document.id, id));
  if (!doc || doc.ownerId !== user.id) notFound();

  const fields = await db
    .select()
    .from(field)
    .where(eq(field.documentId, id))
    .orderBy(asc(field.page));

  const prefilledCount = fields.filter((f) => f.prefilled).length;

  const sessions = await db
    .select()
    .from(signingSession)
    .where(eq(signingSession.documentId, id));

  const fieldCount = {
    text: fields.filter((f) => f.type === "text" || f.type === "textarea").length,
    checkbox: fields.filter((f) => f.type === "checkbox").length,
    signature: fields.filter((f) => f.type === "signature").length,
  };

  return (
    <main className="page-shell narrow">
      <Link href="/dashboard" className="back-link">← The desk</Link>

      <div className="doc-detail-hero">
        <div className="kicker">
          {doc.kind === "html" ? "HTML form" : "PDF"} · {doc.status === "draft" ? "drafted" : doc.status === "completed" ? "returned" : "sealed and sent"}
        </div>
        <h2>{doc.title}</h2>
      </div>

      <section className="section-card">
        <h3>The paper</h3>
        <p style={{ color: "var(--ink-soft)", marginBottom: 16, fontSize: 15 }}>
          {fields.length} field{fields.length === 1 ? "" : "s"} —{" "}
          {fieldCount.text} text, {fieldCount.checkbox} checkbox, {fieldCount.signature} signature.
        </p>
        <div className="action-row">
          {doc.kind === "pdf" && (
            <Link href={`/documents/${id}/edit`} className="btn-secondary">
              Edit fields
            </Link>
          )}
          {doc.kind === "pdf" && (
            <a href={`/api/documents/${id}/pdf`} target="_blank" rel="noopener" className="btn-secondary">
              View original PDF
            </a>
          )}
          {doc.kind === "html" && (
            <a href={`/api/documents/${id}/html`} target="_blank" rel="noopener" className="btn-secondary">
              Preview HTML form
            </a>
          )}
          {doc.kind === "html" && doc.status !== "completed" && (
            <Link href={`/documents/${id}/prefill`} className="btn-secondary">
              {prefilledCount > 0
                ? `Edit pre-fill (${prefilledCount})`
                : doc.status === "sent"
                  ? "Edit fields"
                  : "Pre-fill before sending"}
            </Link>
          )}
          {doc.kind === "pdf" && !!doc.signedPdf && (
            <a href={`/api/documents/${id}/pdf?signed=1`} target="_blank" rel="noopener" className="btn-block">
              View signed PDF →
            </a>
          )}
          {doc.kind === "html" && doc.signedHtml && (
            <a href={`/api/documents/${id}/pdf?signed=1`} target="_blank" rel="noopener" className="btn-block">
              View signed PDF →
            </a>
          )}
        </div>
      </section>

      <section className="section-card">
        <h3>Send for signing</h3>
        {fields.length === 0 ? (
          <p style={{ color: "var(--ink-soft)", fontStyle: "italic" }}>
            Add at least one field before sending.{" "}
            <Link href={`/documents/${id}/edit`} style={{ color: "var(--ink)", fontStyle: "normal", borderBottom: "1px solid var(--rule)" }}>
              Open editor
            </Link>
            .
          </p>
        ) : (
          <SendForm documentId={id} />
        )}
      </section>

      {sessions.length > 0 && (
        <section className="section-card">
          <h3>Recipients</h3>
          {sessions.map((s) => (
            <div key={s.id} className={`recipient-card ${s.signedAt ? "signed" : ""}`}>
              <div className={`seal sm ${s.signedAt ? "signed" : "sent"}`}>
                {s.signedAt ? "✓" : "—"}
              </div>
              <div className="info">
                <div className="name">{s.recipientName || s.recipientEmail}</div>
                <div className="em">{s.recipientEmail}</div>
                <div className="when">
                  {s.signedAt
                    ? `signed ${new Date(s.signedAt).toLocaleString()}`
                    : `sent ${new Date(s.createdAt).toLocaleString()}`}
                </div>
                {!s.signedAt && s.linkClickedAt && (
                  <div className="when" style={{ color: "var(--green)", fontStyle: "italic" }}>
                    opened the link {new Date(s.linkClickedAt).toLocaleString()}
                  </div>
                )}
              </div>
              {!s.signedAt && (
                <a
                  href={`/sign/${s.token}`}
                  target="_blank"
                  rel="noopener"
                  className="text-link"
                  style={{ alignSelf: "start" }}
                >
                  link
                </a>
              )}
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
