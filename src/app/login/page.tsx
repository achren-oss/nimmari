"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await authClient.signIn.email({ email, password });
    setLoading(false);
    if (err) {
      setError(err.message ?? "Invalid credentials.");
      return;
    }
    router.push("/dashboard");
  }

  return (
    <main className="auth-shell">
      <header className="app-top">
        <div className="wm">Nimmari<span className="amp">.</span></div>
        <div className="tagline">— back to your desk.</div>
        <div className="ornament">· · ·</div>
      </header>

      <h1 className="page-title">Log <strong>in.</strong></h1>

      <form onSubmit={onSubmit} className="paper-form">
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
            className="paper-input"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary big">
          {loading ? "Signing in..." : "Sign in"} <span className="arr">→</span>
        </button>
      </form>
    </main>
  );
}
