"use client";

type Props = {
  hasSignature: boolean;
  submitting: boolean;
  onSubmit: () => void;
};

export function MobileSignBar({ hasSignature, submitting, onSubmit }: Props) {
  return (
    <div className="signer-mobile-bar">
      <div className="status">
        {hasSignature ? (
          <span className="ok">✓ Signed — ready to seal.</span>
        ) : (
          <span className="pending">Add your signature above first.</span>
        )}
      </div>
      <button onClick={onSubmit} disabled={submitting} className="btn-primary">
        {submitting ? "Sealing..." : "Seal & submit"} <span className="arr">→</span>
      </button>
    </div>
  );
}
