import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session";

export default async function HomePage() {
  const session = await getServerSession();
  if (session?.user) redirect("/dashboard");

  return (
    <main className="page-shell narrow" style={{ textAlign: "center", paddingTop: "10vh" }}>
      <header className="app-top">
        <div className="wm">Puumerkki<span className="amp">.</span></div>
        <div className="tagline">— a quiet desk for documents that need a signature.</div>
        <div className="ornament">· · ·</div>
      </header>
      <p className="page-lede" style={{ marginInline: "auto", textAlign: "center" }}>
        Upload a document — a PDF or an HTML form — drop in fields, send it to the
        recipient. They sign once with their hand; you receive it back, sealed.
      </p>
      <div className="action-row" style={{ justifyContent: "center", marginTop: "32px" }}>
        <Link href="/login" className="btn-secondary">
          Log in
        </Link>
      </div>
    </main>
  );
}
