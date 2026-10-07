"use client";

import { useState } from "react";

export function SendForm({ documentId }: { documentId: string }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [recipientLine, setRecipientLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLink(null);
    setCopied(false);
    setLoading(true);
    const res = await fetch(`/api/documents/${documentId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name }),
    });
    setLoading(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? "Failed to send.");
      return;
    }
    setLink(data.url);
    setEmailSent(!!data.emailSent);
    setRecipientLine(name ? `${name} <${email}>` : email);
    setEmail("");
    setName("");
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback for older browsers — pop a quick prompt with the value preselected
      window.prompt("Copy the signing link:", link);
    }
  }

  function reset() {
    setLink(null);
    setEmailSent(false);
    setRecipientLine(null);
    setCopied(false);
  }

  if (link) {
    return (
      <div className="send-success">
        <div className="send-success-head">
          <div className="seal sm signed">✓</div>
          <div>
            <div className="send-success-title">Signing link sent.</div>
            <div className="send-success-sub">
              {emailSent ? (
                <>Despatched to <strong>{recipientLine}</strong> via email.</>
              ) : (
                <>Email isn&apos;t configured — copy the link below and send it manually to <strong>{recipientLine}</strong>.</>
              )}
            </div>
          </div>
        </div>

        <div className="send-link-row">
          <code className="send-link-url" title={link}>{link}</code>
          <button type="button" onClick={copy} className={`btn-secondary send-copy ${copied ? "copied" : ""}`}>
            {copied ? "✓ Copied" : "Copy link"}
          </button>
        </div>

        <div className="send-success-actions">
          <a href={link} target="_blank" rel="noopener" className="text-link">
            Open the signing page →
          </a>
          <button type="button" onClick={reset} className="text-link">
            Send to someone else
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={send} className="paper-form">
      <div className="send-grid">
        <label className="block">
          <span className="block-label">Recipient email</span>
          <input
            type="email"
            required
            placeholder="recipient@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="paper-input"
          />
        </label>
        <label className="block">
          <span className="block-label">Recipient name <span style={{ color: "var(--muted)" }}>· optional</span></span>
          <input
            placeholder="e.g. Maria Koskinen"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="paper-input"
          />
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" disabled={loading} className="btn-primary">
        {loading ? "Sending..." : "Send signing link"} <span className="arr">→</span>
      </button>
    </form>
  );
}
