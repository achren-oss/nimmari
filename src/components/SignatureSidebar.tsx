"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { SignatureWidget, type SignatureWidgetHandle } from "@/components/SignatureWidget";

type Props = {
  savedSignature: string | null;
  isLoggedIn: boolean;
  initialName?: string;
  onCapture: (dataUrl: string) => void;
  capturedConfirmation?: string;
};

export type SignatureSidebarHandle = {
  // Pull the widget's current data URL (if any) and commit it as captured.
  // Used by the parent on submit to rescue users who drew/typed a signature
  // but didn't click "Use this →" before pressing Seal & submit.
  commitPending: () => string | null;
};

export const SignatureSidebar = forwardRef<SignatureSidebarHandle, Props>(function SignatureSidebar({
  savedSignature,
  isLoggedIn,
  initialName,
  onCapture,
  capturedConfirmation,
}, ref) {
  const widgetRef = useRef<SignatureWidgetHandle>(null);
  const [signaturePng, setSignaturePng] = useState<string | null>(savedSignature);
  const [showWidget, setShowWidget] = useState(!savedSignature);
  const [error, setError] = useState<string | null>(null);

  function capture() {
    const data = widgetRef.current?.getDataUrl();
    if (!data) {
      setError("Please draw, type, or upload your signature.");
      return;
    }
    setSignaturePng(data);
    setShowWidget(false);
    setError(null);
    onCapture(data);
  }

  useImperativeHandle(ref, () => ({
    commitPending: () => {
      // Only relevant when the widget is currently shown (no signature
      // captured yet). If hidden, signature is already in parent state.
      if (!showWidget) return null;
      const data = widgetRef.current?.getDataUrl();
      if (!data) return null;
      setSignaturePng(data);
      setShowWidget(false);
      onCapture(data);
      return data;
    },
  }), [showWidget, onCapture]);

  return (
    <div className="side-card">
      <h3>Your signature</h3>
      {!isLoggedIn && (
        <p className="side-hint">
          Tip: create a Nimmari account and your signature will be saved
          for any future documents.
        </p>
      )}
      {signaturePng && !showWidget ? (
        <div className="sig-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={signaturePng} alt="Your signature" />
          <button type="button" onClick={() => setShowWidget(true)} className="text-link">
            Change signature
          </button>
        </div>
      ) : (
        <div className="sig-pad-block">
          <SignatureWidget
            ref={widgetRef}
            initialName={initialName}
            defaultMode="type"
            height={140}
          />
          <div className="sig-actions">
            <button type="button" onClick={() => widgetRef.current?.clear()} className="text-link">
              Clear
            </button>
            <button type="button" onClick={capture} className="btn-secondary">
              Use this →
            </button>
          </div>
        </div>
      )}
      {error && <p className="form-error" style={{ marginTop: 10 }}>{error}</p>}
      {capturedConfirmation && <p className="side-confirm">{capturedConfirmation}</p>}
    </div>
  );
});
