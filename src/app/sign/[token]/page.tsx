import { eq } from "drizzle-orm";
import { db } from "@/db";
import { document, field, signingSession, user } from "@/db/schema";
import { notFound } from "next/navigation";
import { SignerView } from "@/components/ClientPdf";
import { HtmlSignerView } from "@/components/HtmlSignerView";
import { getServerSession } from "@/lib/session";
import { fillHtml, htmlToShadowParts, htmlVisibleToSigner } from "@/lib/html-form";
import { fieldsVisibleToSigner } from "@/lib/field-visibility";
import { buildSignerFieldPayload, initialSignerValues } from "@/lib/signer-fields";
import { overlayFieldsForViewer, shouldViewStampedPdf } from "@/lib/signer-view-pdf";

export default async function SignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [s] = await db.select().from(signingSession).where(eq(signingSession.token, token));
  if (!s) notFound();

  const [doc] = await db.select().from(document).where(eq(document.id, s.documentId));
  if (!doc) notFound();

  if (doc.status === "cancelled" || doc.status === "declined") {
    return <main className="signed-state">
      <h1>{doc.status === "cancelled" ? "This document has been cancelled" : "This document has been declined"}</h1>
      {s.signedAt && <p><a href={`/api/sign/${token}/pdf`}>View signed PDF →</a></p>}
    </main>;
  }

  const session = await getServerSession();
  let savedSignature: string | null = null;
  if (session?.user) {
    const [u] = await db.select().from(user).where(eq(user.id, session.user.id));
    savedSignature = u?.signaturePng ?? null;
  }

  if (s.signedAt) {
    return (
      <main className="signed-state">
        <h1>Already sealed</h1>
        <p>You signed this paper on {new Date(s.signedAt).toLocaleString()}.</p>
        <p style={{ marginTop: 24 }}>
          <a
            href={`/api/sign/${token}/pdf`}
            target="_blank"
            rel="noopener"
            className="btn-block"
          >
            View signed PDF →
          </a>
        </p>
      </main>
    );
  }

  if (s.expiresAt < new Date()) {
    return (
      <main className="signed-state">
        <h1>Link expired</h1>
        <p>Ask the sender to despatch a fresh one.</p>
      </main>
    );
  }

  if (doc.kind === "html") {
    const allFields = await db.select().from(field).where(eq(field.documentId, doc.id));
    const visibleFields = fieldsVisibleToSigner(allFields, s.recipientEmail, s.signerKey);
    const prefilled: Record<string, string> = {};
    for (const f of visibleFields) {
      if (f.prefilled && f.name && f.value !== null) {
        prefilled[f.name] = f.value;
      }
    }
    const renderedHtml =
      Object.keys(prefilled).length > 0
        ? fillHtml(doc.htmlSource ?? "", prefilled, null, { disableMode: "filled-only" })
        : (doc.htmlSource ?? "");

    const { styles: shadowStyles, body: shadowBody } = htmlToShadowParts(htmlVisibleToSigner(renderedHtml, allFields, s));

    return (
      <HtmlSignerView
        token={token}
        documentTitle={doc.title}
        recipientName={s.recipientName}
        recipientEmail={s.recipientEmail}
        shadowStyles={shadowStyles}
        shadowBody={shadowBody}
        savedSignature={savedSignature}
        isLoggedIn={!!session?.user}
      />
    );
  }

  const fields = await db.select().from(field).where(eq(field.documentId, s.documentId));
  const sessions = await db
    .select()
    .from(signingSession)
    .where(eq(signingSession.documentId, s.documentId));
  const viewingStamped = shouldViewStampedPdf({
    kind: doc.kind,
    hasSignedPdf: !!doc.signedPdf,
    priorSignedCount: sessions.filter((x) => x.signedAt).length,
  });
  const signerFields = overlayFieldsForViewer(
    buildSignerFieldPayload(fields, s.recipientEmail, s.signerKey),
    viewingStamped,
  );
  const initialValues = initialSignerValues(signerFields);

  return (
    <SignerView
      token={token}
      documentId={doc.id}
      documentTitle={doc.title}
      recipientName={s.recipientName}
      recipientEmail={s.recipientEmail}
      fields={signerFields}
      initialValues={initialValues}
      savedSignature={savedSignature}
      isLoggedIn={!!session?.user}
    />
  );
}
