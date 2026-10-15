"use client";

import { signDoneUrl } from "@/lib/sign-done";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { SignatureSidebar, type SignatureSidebarHandle } from "@/components/SignatureSidebar";
import { DeclineButton } from "@/components/DeclineButton";
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

export function HtmlSignerView({
  token,
  documentTitle,
  recipientName,
  recipientEmail,
  shadowStyles,
  shadowBody,
  savedSignature,
  isLoggedIn,
}: {
  token: string;
  documentTitle: string;
  recipientName: string | null;
  recipientEmail: string;
  shadowStyles: string;
  shadowBody: string;
  savedSignature: string | null;
  isLoggedIn: boolean;
}) {
  const router = useRouter();
  const hostRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);
  const sidebarRef = useRef<SignatureSidebarHandle>(null);
  const [signaturePng, setSignaturePng] = useState<string | null>(savedSignature);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signaturePainted, setSignaturePainted] = useState(false);
  const [shadowReady, setShadowReady] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [restored, setRestored] = useState<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mount shadow DOM and inject the form's styles + body once on first render.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    // Inject our own override stylesheet AFTER the form's so we can win on
    // visual affordances without form CSS conflicts. Gives recipients a clear
    // "this is yours to fill" cue (DocuSign-style soft yellow tint) on every
    // empty fillable field. Disabled (pre-filled) fields stay untreated so
    // they read as static content.
    const overrides = `<style>
      /* Text inputs & textareas — soft yellow tint while empty, brighter on focus. */
      .pm-form-root input[data-pm-field]:not([disabled]):not([type="checkbox"]):not([type="radio"]),
      .pm-form-root textarea[data-pm-field]:not([disabled]) {
        background-color: rgba(255, 215, 0, 0.14) !important;
        transition: background-color 0.15s ease, box-shadow 0.15s ease;
      }
      .pm-form-root input[data-pm-field]:not([disabled]):not([type="checkbox"]):not([type="radio"]):focus,
      .pm-form-root textarea[data-pm-field]:not([disabled]):focus {
        background-color: rgba(255, 215, 0, 0.28) !important;
        outline: 2px solid rgba(184, 138, 44, 0.8) !important;
        outline-offset: 1px;
      }
      /* Date inputs are also fillable, same treatment */
      .pm-form-root input[type="date"][data-pm-field]:not([disabled]) {
        background-color: rgba(255, 215, 0, 0.14) !important;
      }
      /* No halo on checkboxes for now. Root cause of the "checkmark only
         appears after tapping outside" bug was the :focus rule above
         applying to checkboxes (because it didn't exclude type="checkbox"),
         clobbering the form's :checked { background: #111 } so the white
         :checked::after pseudo became invisible on yellow. Fixed by
         excluding checkbox/radio from the focus selector. A halo could
         be re-added safely now that the focus rule is scoped. */
      /* Signature slot before capture — dashed accent border + faint tint. */
      .pm-form-root .pm-signature[data-pm-field]:not(.has-signature) {
        background-color: rgba(255, 215, 0, 0.14);
        outline: 2px dashed rgba(184, 58, 38, 0.5);
        outline-offset: 2px;
        cursor: pointer;
      }
      .pm-form-root .pm-signature[data-pm-field]:not(.has-signature):hover {
        outline-color: rgba(138, 58, 38, 0.9);
        background-color: rgba(255, 215, 0, 0.22);
      }
      /* Already-captured signature: keep cursor pointer for re-sign,
         but no tint so the signature reads cleanly. */
      .pm-form-root .pm-signature.has-signature { cursor: pointer; }
    </style>`;
    shadow.innerHTML = shadowStyles + overrides + shadowBody;
    shadowRef.current = shadow;

    // Block native form submission inside the shadow tree (we handle submit ourselves).
    const onFormSubmit = (e: Event) => e.preventDefault();
    shadow.addEventListener("submit", onFormSubmit, true);

    // Tap on a signature placeholder → scroll to the side panel (where the
    // recipient actually captures the signature). Works on mobile (where the
    // form is above the panel after stack) and is a no-op on desktop.
    const onShadowClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const slot = target.closest(".pm-signature");
      if (!slot) return;
      e.preventDefault();
      const sidecard = document.getElementById("nimmari-signature-card");
      sidecard?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    shadow.addEventListener("click", onShadowClick);

    setShadowReady(true);
    return () => {
      shadow.removeEventListener("submit", onFormSubmit, true);
      shadow.removeEventListener("click", onShadowClick);
    };
  }, [shadowStyles, shadowBody]);

  function root(): ParentNode | null {
    return shadowRef.current;
  }

  function collectValues(scope: ParentNode): Record<string, string> {
    const values: Record<string, string> = {};
    const fields = scope.querySelectorAll<HTMLElement>("[data-pm-field]");
    fields.forEach((el) => {
      const name = el.getAttribute("data-pm-field");
      if (!name) return;
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute("type")?.toLowerCase();
      if (
        el.classList.contains("pm-signature") ||
        el.getAttribute("data-pm-type") === "signature"
      ) return;
      if (tag === "input" && type === "checkbox") {
        values[name] = (el as HTMLInputElement).checked ? "true" : "false";
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

  function applyValues(scope: ParentNode, values: Record<string, string>) {
    scope.querySelectorAll<HTMLElement>("[data-pm-field]").forEach((el) => {
      // Pre-filled fields render as `disabled` from the server. Don't touch them.
      if ((el as HTMLInputElement).disabled) return;
      const name = el.getAttribute("data-pm-field");
      if (!name || !(name in values)) return;
      const v = values[name];
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute("type")?.toLowerCase();
      if (el.classList.contains("pm-signature") || el.getAttribute("data-pm-type") === "signature") return;
      if (tag === "input" && type === "checkbox") {
        (el as HTMLInputElement).checked = v === "true";
        return;
      }
      if (tag === "fieldset") {
        const groupName = el.querySelector<HTMLInputElement>('input[type="radio"]')?.name;
        if (!groupName || !v) return;
        const radio = el.querySelector<HTMLInputElement>(
          `input[type="radio"][name="${groupName}"][value="${v}"]`,
        );
        if (radio) radio.checked = true;
        return;
      }
      if (tag === "input" || tag === "textarea") {
        (el as HTMLInputElement | HTMLTextAreaElement).value = v;
        return;
      }
    });
  }

  const queueSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const r = root();
      if (!r) return;
      const draft: Draft = {
        values: collectValues(r),
        signaturePng,
        savedAt: Date.now(),
      };
      writeDraft(token, draft);
      setSavedAt(draft.savedAt);
    }, 350);
  }, [token, signaturePng]);

  // On shadow ready: restore draft, wire up auto-save on input/change.
  useEffect(() => {
    if (!shadowReady) return;
    const r = root();
    if (!r) return;
    const draft = readDraft(token);
    if (draft) {
      applyValues(r, draft.values);
      if (draft.signaturePng && !signaturePng) {
        // Restore client-only localStorage state after hydration.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSignaturePng(draft.signaturePng);
      }
      setRestored(draft.savedAt);
      setSavedAt(draft.savedAt);
    }
    const onChange = () => queueSave();
    r.addEventListener("input", onChange);
    r.addEventListener("change", onChange);
    return () => {
      r.removeEventListener("input", onChange);
      r.removeEventListener("change", onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shadowReady, token]);

  // Save when signature changes.
  useEffect(() => {
    if (!shadowReady) return;
    queueSave();
  }, [signaturePng, shadowReady, queueSave]);

  // Paint signature into all matching slots.
  useEffect(() => {
    if (!shadowReady) return;
    const r = root();
    if (!r) return;
    const slots = r.querySelectorAll<HTMLElement>(
      '[data-pm-field][data-pm-type="signature"], .pm-signature[data-pm-field]',
    );
    slots.forEach((slot) => {
      slot.innerHTML = "";
      if (signaturePng) {
        const img = document.createElement("img");
        img.src = signaturePng;
        img.alt = "Signature";
        img.style.maxWidth = "100%";
        img.style.maxHeight = "100%";
        img.style.height = "auto";
        img.style.display = "block";
        slot.appendChild(img);
        slot.classList.add("has-signature");
      } else {
        slot.classList.remove("has-signature");
        slot.textContent = "Sign here";
      }
    });
    setSignaturePainted(!!signaturePng && slots.length > 0);
  }, [signaturePng, shadowReady]);

  async function submit() {
    setError(null);
    const r = root();
    if (!r) {
      setError("Form not loaded yet.");
      return;
    }
    const values = collectValues(r);

    // Rescue: if the user typed/drew a signature in the widget but never
    // clicked "Use this →", commit it now. setSignaturePng is async so we
    // also use the returned data URL inline below.
    const rescued = signaturePng ?? sidebarRef.current?.commitPending() ?? null;

    // Collect ALL missing required fields at once (not just the first).
    r.querySelectorAll<HTMLElement>("[data-pm-missing]").forEach((el) => {
      el.removeAttribute("data-pm-missing");
      el.style.outline = "";
      el.style.outlineOffset = "";
    });
    const missing: { label: string; el: HTMLElement }[] = [];
    r.querySelectorAll<HTMLElement>("[data-pm-field]").forEach((el) => {
      const name = el.getAttribute("data-pm-field");
      if (!name) return;
      const label = el.getAttribute("data-pm-label") ?? name;
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute("type")?.toLowerCase();
      const isSig =
        el.classList.contains("pm-signature") ||
        el.getAttribute("data-pm-type") === "signature" || tag === "div" || tag === "span";
      if (!isSig && (!el.hasAttribute("data-pm-required") || (el as HTMLInputElement).disabled)) return;
      let isMissing = false;
      if (isSig) isMissing = !rescued;
      else if (tag === "input" && type === "checkbox") isMissing = !(el as HTMLInputElement).checked;
      else if (tag === "fieldset") isMissing = !values[name];
      else isMissing = !values[name]?.trim();
      if (isMissing) missing.push({ label, el });
    });
    if (missing.length > 0) {
      for (const m of missing) {
        m.el.setAttribute("data-pm-missing", "true");
        m.el.style.outline = "2px solid #dc2626";
        m.el.style.outlineOffset = "2px";
      }
      setError(
        `Complete ${missing.length} remaining required fields: ${missing.map((m) => m.label).join(", ")}`,
      );
      missing[0].el.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setSubmitting(true);
    const res = await fetch(`/api/sign/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values, signaturePng: rescued }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      setError(d?.error ?? "Failed to submit.");
      return;
    }
    clearDraft(token);
    const notices = await res.json();
    router.push(signDoneUrl(token, notices));
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
          <div className="signer-form-wrap">
            <div ref={hostRef} className="shadow-host" />
          </div>
        </div>

        <aside className="signer-side">
          <div id="nimmari-signature-card" style={{ scrollMarginTop: 16 }}>
            <SignatureSidebar
              ref={sidebarRef}
              savedSignature={savedSignature}
              isLoggedIn={isLoggedIn}
              initialName={recipientName ?? ""}
              onCapture={(d) => setSignaturePng(d)}
              capturedConfirmation={signaturePainted ? "— stamped onto the document." : undefined}
            />
          </div>

          <DraftIndicator restored={restored} savedAt={savedAt} />

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
        submitting={submitting}
        onSubmit={submit}
      />
    </main>
  );
}

function DraftIndicator({
  restored,
  savedAt,
}: {
  restored: number | null;
  savedAt: number | null;
}) {
  const ts = savedAt ?? restored;
  if (!ts) return null;
  const time = new Date(ts).toLocaleTimeString();
  return (
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
        ? `Restored your draft from ${time} — keep filling, we save as you go.`
        : `✓ Saved at ${time} — your progress is kept in this browser, even if you close it.`}
    </div>
  );
}
