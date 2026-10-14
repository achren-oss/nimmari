"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Document, Page } from "react-pdf";
import "@/components/PdfWorker";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { SignatureSidebar, type SignatureSidebarHandle } from "@/components/SignatureSidebar";
import { DeclineButton } from "@/components/DeclineButton";
import { MobileSignBar } from "@/components/MobileSignBar";
import { PDF_OVERLAY_WIDTH } from "@/lib/pdf-coords";
import { missingRequiredFields, requiredForSigner, shortFieldLabel } from "@/lib/required-fields";

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

type FieldType = "text" | "textarea" | "checkbox" | "signature" | "date" | "hetu";

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
  prefilled?: boolean;
  readOnly?: boolean;
  value?: string | null;
};

export function SignerView({
  token,
  documentId,
  documentTitle,
  recipientName,
  recipientEmail,
  fields,
  initialValues,
  savedSignature,
  isLoggedIn,
}: {
  token: string;
  documentId: string;
  documentTitle: string;
  recipientName: string | null;
  recipientEmail: string;
  fields: Field[];
  initialValues?: Record<string, string>;
  savedSignature: string | null;
  isLoggedIn: boolean;
}) {
  const router = useRouter();
  const [numPages, setNumPages] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pageWidth, setPageWidth] = useState(PDF_OVERLAY_WIDTH);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (inner > 0) setPageWidth(Math.min(PDF_OVERLAY_WIDTH, Math.floor(inner)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = pageWidth / PDF_OVERLAY_WIDTH;
  const [values, setValues] = useState<Record<string, string>>(() => initialValues ?? {});
  const [signaturePng, setSignaturePng] = useState<string | null>(savedSignature);
  const [error, setError] = useState<string | null>(null);
  const [missingIds, setMissingIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [restored, setRestored] = useState<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(false);
  const sidebarRef = useRef<SignatureSidebarHandle>(null);

  const fileSrc = `/api/documents/${documentId}/pdf?t=${token}`;
  const hasSignatureField = fields.some((f) => f.type === "signature");

  // Restore draft once on mount.
  useEffect(() => {
    const draft = readDraft(token);
    if (draft) {
      // Restore client-only localStorage state after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValues({ ...(initialValues ?? {}), ...draft.values });
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
    if (missingIds.has(id)) {
      setMissingIds((m) => {
        const n = new Set(m);
        n.delete(id);
        return n;
      });
    }
  }

  const requiredFields = requiredForSigner(fields);
  const remaining = missingRequiredFields(fields, values, !!signaturePng).length;
  const doneCount = requiredFields.length - remaining;

  async function submit() {
    setError(null);

    // Auto-commit pending signature before validation (fixes iPhone issue where
    // user draws but doesn't tap "Use this →" before hitting Seal & submit).
    const committedSig = sidebarRef.current?.commitPending();
    const effectiveSig = committedSig ?? signaturePng;
    if (committedSig) setSignaturePng(committedSig);

    const missing = missingRequiredFields(fields, values, !!effectiveSig);
    // Any signature box needs a signature even if not flagged required.
    const sigField = fields.find((f) => f.type === "signature" && !f.readOnly);
    if (hasSignatureField && !effectiveSig && sigField && !missing.some((f) => f.type === "signature")) {
      missing.push(sigField);
    }
    if (missing.length > 0) {
      setMissingIds(new Set(missing.map((f) => f.id)));
      setError(
        `Complete ${missing.length} remaining required fields: ` +
          missing.map((f) => shortFieldLabel(f.label) || (f.type === "signature" ? "signature" : "field")).join(", "),
      );
      document
        .getElementById(`pm-field-${missing[0].id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setMissingIds(new Set());

    setSubmitting(true);
    const res = await fetch(`/api/sign/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values, signaturePng: effectiveSig }),
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

      {requiredFields.length > 0 && (
        <div
          className="pm-required-banner"
          role="status"
          style={{
            margin: "0 auto 12px", maxWidth: 840,
            padding: "10px 14px", borderRadius: 4, fontSize: 14,
            background: remaining > 0 ? "#fff4e5" : "rgba(74,107,63,0.10)",
            border: `1px solid ${remaining > 0 ? "#f0b45a" : "rgba(74,107,63,0.3)"}`,
          }}
        >
          {remaining > 0
            ? `${remaining} required fields remaining (${doneCount}/${requiredFields.length} complete). Required fields are marked with *.`
            : `All required fields complete (${requiredFields.length}/${requiredFields.length}). You can sign.`}
          {error && <div style={{ marginTop: 6, color: "#b42318" }}>{error}</div>}
        </div>
      )}

      <div className="signer-grid">
        <div>
          <div ref={wrapRef} className="signer-form-wrap" style={{ padding: 16 }}>
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
                  style={{ width: pageWidth }}
                >
                  <Page pageNumber={i + 1} width={pageWidth} renderTextLayer={false} />
                  {fields
                    .filter((f) => f.page === i)
                    .map((f) => (
                      <FieldOverlay
                        key={f.id}
                        field={f}
                        value={values[f.id] ?? f.value ?? ""}
                        onChange={(v) => setVal(f.id, v)}
                        signaturePng={signaturePng}
                        readOnly={!!(f.readOnly || f.prefilled)}
                        missing={missingIds.has(f.id)}
                        scale={scale}
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
            ref={sidebarRef}
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
          <DeclineButton token={token} disabled={submitting} />
          <button onClick={submit} disabled={submitting} className="btn-primary big">
            {submitting ? "Sealing..." : "Seal & submit"} <span className="arr">→</span>
          </button>
        </aside>
      </div>

      <MobileSignBar
        token={token}
        hasSignature={!!signaturePng}
        remaining={remaining}
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
  readOnly,
  missing = false,
  scale = 1,
}: {
  field: Field;
  value: string;
  onChange: (v: string) => void;
  signaturePng: string | null;
  readOnly: boolean;
  missing?: boolean;
  scale?: number;
}) {
  const isRequired = field.required && !readOnly;
  const shortLabel = shortFieldLabel(field.label);
  const placeholder = shortLabel ? `${shortLabel}${isRequired ? " *" : ""}` : isRequired ? "*" : "";
  const missingRing = missing ? " ring-2 ring-red-500 border-red-500 bg-red-50" : "";
  const marker = isRequired ? (
    <span
      aria-hidden
      title="required"
      className="pointer-events-none absolute z-10 rounded bg-red-600 px-1 text-[10px] font-bold leading-4 text-white"
      style={{ left: (field.x + field.width) * scale - 10, top: field.y * scale - 7 }}
    >
      *
    </span>
  ) : null;
  const a11y = {
    id: `pm-field-${field.id}`,
    title: field.label,
    "aria-label": `${field.label ?? ""}${isRequired ? " (required)" : ""}`,
    "aria-required": isRequired,
    "aria-invalid": missing,
  };
  const style = {
    left: field.x * scale,
    top: field.y * scale,
    width: field.width * scale,
    height: field.height * scale,
    // Keep text legible when the page is scaled down on phones.
    fontSize: Math.max(9, Math.min(14, field.height * scale * 0.62)),
    lineHeight: 1,
    paddingTop: 0,
    paddingBottom: 0,
    paddingLeft: 4,
    paddingRight: 4,
  };
  const lockedClass = readOnly
    ? "border-slate-300 bg-slate-100 text-slate-700 cursor-default"
    : "border-blue-400 bg-yellow-50 focus:border-blue-600";
  if (field.type === "textarea") {
    return (
      <>
      {marker}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={readOnly}
        {...a11y}
        className={`absolute box-border resize-none rounded border outline-none ${lockedClass}${missingRing}`}
        style={{ ...style, lineHeight: 1.2, paddingTop: 2, paddingBottom: 2 }}
      />
      </>
    );
  }
  if (field.type === "text" || field.type === "date" || field.type === "hetu") {
    return (
      <>
      {marker}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={field.type === "date" ? "date" : "text"}
        readOnly={readOnly}
        disabled={readOnly}
        {...a11y}
        className={`absolute box-border rounded border outline-none placeholder:text-slate-400 ${lockedClass}${missingRing}`}
        style={style}
      />
      </>
    );
  }
  if (field.type === "checkbox") {
    return (
      <>
      {marker}
      <label
        id={a11y.id}
        title={field.label}
        className={`absolute flex items-center justify-center rounded border-2 ${readOnly ? "border-slate-300 bg-slate-100" : "border-blue-400 bg-yellow-50"}${missingRing}`}
        style={style}
      >
        <input
          type="checkbox"
          checked={value === "true"}
          onChange={(e) => onChange(e.target.checked ? "true" : "false")}
          disabled={readOnly}
          aria-required={isRequired}
          className="h-4 w-4"
        />
      </label>
      </>
    );
  }
  return (
    <>
    {marker}
    <div
      id={a11y.id}
      title={field.label}
      className={`absolute flex items-center justify-center rounded border-2 border-dashed border-blue-400 bg-yellow-50${missingRing}`}
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
        <span className="text-xs text-blue-700">Sign here{isRequired ? " *" : ""} →</span>
      )}
    </div>
    </>
  );
}
