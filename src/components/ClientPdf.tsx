"use client";

// pdf.js (via react-pdf) touches browser-only globals such as DOMMatrix at
// module load. Rendering those components on the server intermittently throws
// "DOMMatrix is not defined" and the page fails to load. Load them client-side only.
import dynamic from "next/dynamic";

export const FieldEditor = dynamic(
  () => import("@/components/FieldEditor").then((m) => m.FieldEditor),
  { ssr: false, loading: () => <p style={{ padding: 24 }}>Loading editor…</p> },
);

export const SignerView = dynamic(
  () => import("@/components/SignerView").then((m) => m.SignerView),
  { ssr: false, loading: () => <p style={{ padding: 24 }}>Loading document…</p> },
);
