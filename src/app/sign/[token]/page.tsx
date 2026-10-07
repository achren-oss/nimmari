import { eq } from "drizzle-orm";
import { db } from "@/db";
import { document, field, signingSession, user } from "@/db/schema";
import { notFound } from "next/navigation";
import { SignerView } from "@/components/ClientPdf";
import { HtmlSignerView } from "@/components/HtmlSignerView";
import { getServerSession } from "@/lib/session";
import { fillHtml, htmlToShadowParts } from "@/lib/html-form";

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
    const prefilled: Record<string, string> = {};
    for (const f of allFields) {
      if (f.prefilled && f.name && f.value !== null) {
        prefilled[f.name] = f.value;
      }
    }
    const renderedHtml =
      Object.keys(prefilled).length > 0
        ? fillHtml(doc.htmlSource ?? "", prefilled, null, { disableMode: "filled-only" })
        : (doc.htmlSource ?? "");

    const { styles: shadowStyles, body: shadowBody } = htmlToShadowParts(renderedHtml);

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

  return (
    <SignerView
      token={token}
      documentId={doc.id}
      documentTitle={doc.title}
      recipientName={s.recipientName}
      recipientEmail={s.recipientEmail}
      fields={fields
        .filter((f) => f.page !== null && f.x !== null && f.y !== null && f.width !== null && f.height !== null)
        .map((f) => ({
          id: f.id,
          type: f.type,
          page: f.page!,
          x: f.x!,
          y: f.y!,
          width: f.width!,
          height: f.height!,
          label: f.label ?? undefined,
          required: f.required,
        }))}
      savedSignature={savedSignature}
      isLoggedIn={!!session?.user}
    />
  );
}
