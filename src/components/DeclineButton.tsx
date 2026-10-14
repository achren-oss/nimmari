"use client";
import { useState } from "react";

export function DeclineButton({ token, disabled }: { token: string; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function decline() {
    setBusy(true);
    try {
      const response = await fetch(`/api/sign/${token}/decline`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
      if (response.ok) { window.location.reload(); return; }
      const body = await response.json();
      setError(body.error ?? "Decline failed");
    } catch { setError("Decline failed. Please try again."); }
    setBusy(false);
  }
  return <div className="decline-control">
    <button type="button" disabled={disabled || busy} onClick={() => setOpen(!open)}>Decline</button>
    {open && <div className="decline-dialog" role="dialog" aria-modal="true" aria-label="Confirm decline">
      <p>Declining ends signing for everyone.</p>
      <label>Reason (optional)<textarea maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={busy || disabled} onClick={decline}>Confirm decline</button>
      <button type="button" disabled={busy} onClick={() => setOpen(false)}>Back</button>
    </div>}
  </div>;
}
