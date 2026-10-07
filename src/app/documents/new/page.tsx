"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Mode = "pdf" | "html";

export default function NewDocumentPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("pdf");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function pickFile(f: File | null) {
    setFile(f);
    setError(null);
    if (!f) return;
    const isHtml = f.name.toLowerCase().endsWith(".html") || f.type === "text/html";
    const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    if (isHtml) setMode("html");
    else if (isPdf) setMode("pdf");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a file.");
      return;
    }
    setError(null);
    setLoading(true);

    const fd = new FormData();
    const fallbackTitle = title || file.name.replace(/\.(pdf|html?)$/i, "");
    fd.append("title", fallbackTitle);

    let endpoint: string;
    if (mode === "html") {
      fd.append("html", file);
      endpoint = "/api/documents/html";
    } else {
      fd.append("pdf", file);
      endpoint = "/api/documents";
    }

    const res = await fetch(endpoint, { method: "POST", body: fd });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Upload failed.");
      return;
    }
    const { id } = await res.json();
    router.push(mode === "html" ? `/documents/${id}` : `/documents/${id}/edit`);
  }

  return (
    <main className="page-shell narrow">
      <Link href="/dashboard" className="back-link">← The desk</Link>
      <h1 className="page-title">Lay down a new paper.</h1>
      <p className="page-lede">
        Upload a PDF and we&apos;ll let you place fields on it. Or upload an HTML form
        produced from a paper photograph — we&apos;ll detect the fields automatically.
      </p>

      <form onSubmit={onSubmit} className="paper-form">
        <div className="seg">
          <button type="button" onClick={() => setMode("pdf")} className={mode === "pdf" ? "on" : ""}>
            <span className="seg-name">PDF document</span>
            <span className="seg-hint">Place fields by hand</span>
          </button>
          <button type="button" onClick={() => setMode("html")} className={mode === "html" ? "on" : ""}>
            <span className="seg-name">HTML form</span>
            <span className="seg-hint">Fields detected automatically</span>
          </button>
        </div>

        <label className="block">
          <span className="block-label">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Optional — defaults to filename"
            className="paper-input"
          />
        </label>

        <label className="block">
          <span className="block-label">{mode === "html" ? "HTML form" : "PDF"}</span>
          <input
            type="file"
            accept={mode === "html" ? ".html,text/html" : "application/pdf"}
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            required
            className="paper-file"
          />
          {file && (
            <span className="file-note">{file.name} · {(file.size / 1024).toFixed(0)} kB</span>
          )}
        </label>

        {error && <p className="form-error">{error}</p>}

        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "Uploading..." : "Continue"} <span className="arr">→</span>
        </button>
      </form>
    </main>
  );
}
