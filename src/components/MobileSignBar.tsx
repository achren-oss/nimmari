"use client";

import { DeclineButton } from "./DeclineButton";

type Props = {
  token: string;
  hasSignature: boolean;
  remaining?: number;
  submitting: boolean;
  onSubmit: () => void;
};

export function MobileSignBar({ token, hasSignature, remaining = 0, submitting, onSubmit }: Props) {
  return (
    <div className="signer-mobile-bar">
      <div className="status">
        {remaining > 0 ? (
          <span className="pending">{remaining} required fields remaining *</span>
        ) : hasSignature ? (
          <span className="ok">✓ Signed — ready to seal.</span>
        ) : (
          <span className="pending">Add your signature above first.</span>
        )}
      </div>
      <DeclineButton token={token} disabled={submitting} />
      <button onClick={onSubmit} disabled={submitting} className="btn-primary">
        {submitting ? "Sealing..." : "Seal & submit"} <span className="arr">→</span>
      </button>
    </div>
  );
}
