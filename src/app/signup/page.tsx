"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SignatureWidget, type SignatureWidgetHandle } from "@/components/SignatureWidget";
import { authClient } from "@/lib/auth-client";

export default function SignupPage() {
  const router = useRouter();
  const widgetRef = useRef<SignatureWidgetHandle>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const sig = widgetRef.current?.getDataUrl();
    if (!sig) {
      setError("Please draw, type, or upload your signature.");
      return;
    }
    setLoading(true);
    const { error: err } = await authClient.signUp.email({
      name,
      email,
      password,
      signaturePng: sig,
    });
    setLoading(false);
    if (err) {
      setError(err.message ?? "Signup failed.");
      return;
    }
    router.push("/dashboard");
  }

  return (
    <main className="auth-shell">
      <header className="app-top">
        <div className="wm">Puumerkki<span className="amp">.</span></div>
        <div className="tagline">— take your signature, once.</div>
        <div className="ornament">· · ·</div>
      </header>

      <h1 className="page-title">Create an <strong>account.</strong></h1>
      <p className="page-lede">
        Capture your signature once. We&apos;ll reuse it whenever you sign a
        document from this desk.
      </p>

      <form onSubmit={onSubmit} className="paper-form">
        <label className="block">
          <span className="block-label">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="paper-input"
          />
        </label>
        <label className="block">
          <span className="block-label">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="paper-input"
          />
        </label>
        <label className="block">
          <span className="block-label">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="paper-input"
          />
        </label>
        <div className="block">
          <span className="block-label">Signature</span>
          <SignatureWidget ref={widgetRef} initialName={name} defaultMode="type" />
        </div>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary big">
          {loading ? "Creating..." : "Create account"} <span className="arr">→</span>
        </button>
        <p style={{ textAlign: "center", color: "var(--ink-soft)", fontStyle: "italic", fontSize: 14 }}>
          Already have an account?{" "}
          <Link href="/login" style={{ color: "var(--ink)", borderBottom: "1px solid var(--rule)", paddingBottom: 1 }}>
            Log in
          </Link>
        </p>
      </form>
    </main>
  );
}
