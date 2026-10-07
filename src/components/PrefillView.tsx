"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function PrefillView({
  documentId,
  htmlSource,
}: {
  documentId: string;
  htmlSource: string;
}) {
  const router = useRouter();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const resizeIframe = useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) return;
    const h = Math.max(
      doc.documentElement.scrollHeight,
      doc.body?.scrollHeight ?? 0,
    );
    iframe.style.height = `${h}px`;
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let ro: ResizeObserver | null = null;
    const onLoad = () => {
      resizeIframe();
      const doc = iframe.contentDocument;
      if (doc?.body && typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => resizeIframe());
        ro.observe(doc.body);
      }
    };
    iframe.addEventListener("load", onLoad);
    return () => {
      iframe.removeEventListener("load", onLoad);
      ro?.disconnect();
    };
  }, [resizeIframe]);

  function collectValues(doc: Document): Record<string, string> {
    const values: Record<string, string> = {};
    const fields = doc.querySelectorAll<HTMLElement>("[data-pm-field]");
    fields.forEach((el) => {
      const name = el.getAttribute("data-pm-field");
      if (!name) return;
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute("type")?.toLowerCase();
      const isSig =
        el.classList.contains("pm-signature") ||
        el.getAttribute("data-pm-type") === "signature";
      if (isSig) return;
      if (tag === "input" && type === "checkbox") {
        values[name] = (el as HTMLInputElement).checked ? "true" : "";
        return;
      }
      if (tag === "fieldset") {
        const groupName = el.querySelector<HTMLInputElement>('input[type="radio"]')?.name;
        if (!groupName) return;
        const checked = el.querySelector<HTMLInputElement>(
          `input[type="radio"][name="${groupName}"]:checked`,
        );
        values[name] = checked?.value ?? "";
        return;
      }
      if (tag === "input" || tag === "textarea") {
        values[name] = (el as HTMLInputElement | HTMLTextAreaElement).value ?? "";
        return;
      }
    });
    return values;
  }

  async function save() {
    setError(null);
    const doc = iframeRef.current?.contentDocument;
    if (!doc) {
      setError("Form not loaded yet.");
      return;
    }
    const values = collectValues(doc);
    setSaving(true);
    const res = await fetch(`/api/documents/${documentId}/prefill`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      setError(d?.error ?? "Save failed.");
      return;
    }
    setSavedAt(new Date().toLocaleTimeString());
  }

  return (
    <div className="signer-grid">
      <div>
        <div className="signer-form-wrap">
          <iframe
            ref={iframeRef}
            srcDoc={htmlSource}
            sandbox="allow-same-origin"
            title="Pre-fill form"
            style={{ width: "100%", minHeight: 600, border: 0, display: "block" }}
          />
        </div>
      </div>

      <aside className="signer-side">
        <div className="side-card">
          <h3>Pre-fill</h3>
          <p className="side-hint">
            Fill any fields you want locked before sending. The recipient
            sees them as read-only and fills the rest.
          </p>
          {error && <div className="form-error" style={{ marginTop: 10 }}>{error}</div>}
          {savedAt && <p className="side-confirm">— saved at {savedAt}.</p>}
        </div>
        <button onClick={save} disabled={saving} className="btn-primary big">
          {saving ? "Saving..." : "Save & continue"} <span className="arr">→</span>
        </button>
        <button
          type="button"
          onClick={() => router.push(`/documents/${documentId}`)}
          className="btn-secondary"
          style={{ width: "100%", justifyContent: "center" }}
        >
          Cancel
        </button>
      </aside>
    </div>
  );
}
