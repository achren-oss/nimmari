"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Document, Page } from "react-pdf";
import "@/components/PdfWorker";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { SignatureSidebar } from "@/components/SignatureSidebar";
import { MobileSignBar } from "@/components/MobileSignBar";

const DRAFT_PREFIX = "puumerkki:draft:";

type Draft = {
  values: Record<string, string>;
  signaturePng: string | null;
  savedAt: number;
};

function readDraft(token: string): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + token);
    if (!raw) return null;
    return JSON.parse(raw) as Draft;
  } catch {
    return null;
  }
}
function writeDraft(token: string, d: Draft) {
  try { localStorage.setItem(DRAFT_PREFIX + token, JSON.stringify(d)); } catch {}
}
function clearDraft(token: string) {
  try { localStorage.removeItem(DRAFT_PREFIX + token); } catch {}
}

type FieldType = "text" | "textarea" | "checkbox" | "signature";

type Field = {
  id: string;
  type: FieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  required: boolean;
};

const PAGE_WIDTH = 800;

export function SignerView({
  token,
  documentId,
  documentTitle,
  recipientName,
  recipientEmail,
  fields,
  savedSignature,
  isLoggedIn,
}: {
  token: string;
  documentId: string;
  documentTitle: string;
  recipientName: string | null;
  recipientEmail: string;
  fields: Field[];
  savedSignature: string | null;
  isLoggedIn: boolean;
}) {
  const router = useRouter();
  const [numPages, setNumPages] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [signaturePng, setSignaturePng] = useState<string | null>(savedSignature);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [restored, setRestored] = useState<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(false);

  const fileSrc = `/api/documents/${documentId}/pdf?t=${token}`;
  const hasSignatureField = fields.some((f) => f.type === "signature");

  // Restore draft once on mount.
  useEffect(() => {
    const draft = readDraft(token);
    if (draft) {
      // Restore client-only localStorage state after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValues(draft.values);
      if (draft.signaturePng && !signaturePng) setSignaturePng(draft.signaturePng);
      setRestored(draft.savedAt);
      setSavedAt(draft.savedAt);
    }
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Auto-save on values / signature change (debounced).
  useEffect(() => {
    if (!hydrated.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const draft: Draft = { values, signaturePng, savedAt: Date.now() };
      writeDraft(token, draft);
      setSavedAt(draft.savedAt);
    }, 350);
  }, [values, signaturePng, token]);

  function setVal(id: string, v: string) {
    setValues((s) => ({ ...s, [id]: v }));
  }

  async function submit() {
    setError(null);
    for (const f of fields) {
      if (!f.required) continue;
      if ((f.type === "text" || f.type === "textarea") && !values[f.id]?.trim()) {
        setError(`Please fill: ${f.label ?? "text field"}`);
        return;
      }
      if (f.type === "checkbox" && values[f.id] !== "true") {
        setError(`Please check: ${f.label ?? "checkbox"}`);
        return;
      }
    }
    if (hasSignatureField && !signaturePng) {
      setError("Please provide a signature.");
      return;
    }

    setSubmitting(true);
    const res = await fetch(`/api/sign/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values, signaturePng }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      setError(d?.error ?? "Failed to submit.");
      return;
    }
    clearDraft(token);
    router.push(`/sign/${token}/done`);
  }

  return (
    <main className="signer-shell">
      <header className="signer-head">
        <div className="signer-kicker">A document for your signature</div>
        <h1>{documentTitle}</h1>
        <div className="signer-meta">
          Signing as {recipientName ? `${recipientName} (${recipientEmail})` : recipientEmail}
        </div>
      </header>

      <div className="signer-grid">
        <div>
          <div className="signer-form-wrap" style={{ padding: 16 }}>
          <Document
            file={fileSrc}
            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
            loading={<div className="text-slate-500">Loading PDF…</div>}
          >
            <div className="space-y-6">
              {Array.from({ length: numPages }, (_, i) => (
                <div
                  key={i}
                  className="relative inline-block bg-white shadow ring-1 ring-slate-200"
                  style={{ width: PAGE_WIDTH }}
                >
                  <Page pageNumber={i + 1} width={PAGE_WIDTH} renderTextLayer={false} />
                  {fields
                    .filter((f) => f.page === i)
                    .map((f) => (
                      <FieldOverlay
                        key={f.id}
                        field={f}
                        value={values[f.id] ?? ""}
                        onChange={(v) => setVal(f.id, v)}
                        signaturePng={signaturePng}
                      />
                    ))}
                </div>
              ))}
            </div>
          </Document>
          </div>
        </div>

        <aside className="signer-side">
          <SignatureSidebar
            savedSignature={savedSignature}
            isLoggedIn={isLoggedIn}
            initialName={recipientName ?? ""}
            onCapture={(d) => setSignaturePng(d)}
          />
          {(savedAt || restored) && (
            <div
              style={{
                fontSize: 12,
                fontStyle: "italic",
                color: "var(--green)",
                padding: "8px 14px",
                background: "rgba(74,107,63,0.07)",
                border: "1px solid rgba(74,107,63,0.18)",
                borderRadius: 2,
              }}
            >
              {restored && restored === savedAt
                ? `Restored your draft from ${new Date(restored).toLocaleTimeString()} — keep filling, we save as you go.`
                : `✓ Saved at ${new Date(savedAt!).toLocaleTimeString()} — your progress is kept in this browser, even if you close it.`}
            </div>
          )}
          {error && <div className="form-error">{error}</div>}
          <button onClick={submit} disabled={submitting} className="btn-primary big">
            {submitting ? "Sealing..." : "Seal & submit"} <span className="arr">→</span>
          </button>
        </aside>
      </div>

      <MobileSignBar
        hasSignature={!!signaturePng}
        submitting={submitting}
        onSubmit={submit}
      />
    </main>
  );
}

function FieldOverlay({
  field,
  value,
  onChange,
  signaturePng,
}: {
  field: Field;
  value: string;
  onChange: (v: string) => void;
  signaturePng: string | null;
}) {
  const style = {
    left: field.x,
    top: field.y,
    width: field.width,
    height: field.height,
  };
  if (field.type === "textarea") {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.label}
        className="absolute box-border resize-none rounded border border-blue-400 bg-yellow-50 px-2 py-1 text-sm outline-none focus:border-blue-600"
        style={style}
      />
    );
  }
  if (field.type === "text") {
    return (
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.label}
        className="absolute rounded border border-blue-400 bg-yellow-50 px-2 text-sm outline-none focus:border-blue-600"
        style={style}
      />
    );
  }
  if (field.type === "checkbox") {
    return (
      <label
        className="absolute flex items-center justify-center rounded border-2 border-blue-400 bg-yellow-50"
        style={style}
      >
        <input
          type="checkbox"
          checked={value === "true"}
          onChange={(e) => onChange(e.target.checked ? "true" : "false")}
          className="h-4 w-4"
        />
      </label>
    );
  }
  return (
    <div
      className="absolute flex items-center justify-center rounded border-2 border-dashed border-blue-400 bg-yellow-50"
      style={style}
    >
      {signaturePng ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={signaturePng}
          alt="signature"
          className="h-full w-full object-contain p-1"
        />
      ) : (
        <span className="text-xs text-blue-700">Sign here →</span>
      )}
    </div>
  );
}
