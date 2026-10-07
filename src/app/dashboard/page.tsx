import Link from "next/link";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/db";
import { document } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { LogoutButton } from "@/components/LogoutButton";

const STAMP_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "long",
  year: "numeric",
};

const FILTERS = [
  { key: "all", label: "All papers" },
  { key: "draft", label: "Drafts" },
  { key: "sent", label: "Sealed" },
  { key: "completed", label: "Returned" },
] as const;

type Filter = (typeof FILTERS)[number]["key"];

function statusLabel(status: string) {
  if (status === "draft") return "Draft";
  if (status === "completed") return "Returned";
  return "Sealed";
}

function statusSubLabel(status: string) {
  if (status === "draft") return "not yet sent";
  if (status === "completed") return "returned, complete";
  return "awaiting reply";
}

function sealClass(status: string) {
  if (status === "draft") return "draft";
  if (status === "completed") return "signed";
  return "sent";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const user = await requireUser();
  const { filter: rawFilter } = await searchParams;
  const filter: Filter = (FILTERS.find((f) => f.key === rawFilter)?.key ?? "all");

  const where = filter === "all"
    ? eq(document.ownerId, user.id)
    : and(eq(document.ownerId, user.id), eq(document.status, filter));

  const docs = await db
    .select({
      id: document.id,
      title: document.title,
      kind: document.kind,
      status: document.status,
      createdAt: document.createdAt,
    })
    .from(document)
    .where(where)
    .orderBy(desc(document.createdAt));

  const allDocs = filter === "all"
    ? docs
    : await db.select({ status: document.status })
        .from(document)
        .where(eq(document.ownerId, user.id));

  const stats = {
    total: allDocs.length,
    awaiting: allDocs.filter((d) => d.status === "sent").length,
    drafts: allDocs.filter((d) => d.status === "draft").length,
    completed: allDocs.filter((d) => d.status === "completed").length,
  };

  const counts: Record<Filter, number> = {
    all: stats.total,
    draft: stats.drafts,
    sent: stats.awaiting,
    completed: stats.completed,
  };

  return (
    <main className="page-shell">
      <header className="app-top">
        <div className="wm">Puumerkki<span className="amp">.</span></div>
        <div className="tagline">— your desk, this morning.</div>
        <div className="ornament">· · ·</div>
      </header>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 24, gap: 16, flexWrap: "wrap" }}>
        <p style={{ fontStyle: "italic", color: "var(--muted)" }}>
          Signed in as <span style={{ color: "var(--ink)", fontStyle: "normal" }}>{user.email}</span>
        </p>
        <LogoutButton />
      </div>

      <div className="desk-stats">
        <div className="desk-stat">
          <div className="v">{stats.total}</div>
          <div className="l">in circulation</div>
        </div>
        <div className="desk-stat">
          <div className="v"><strong>{stats.awaiting}</strong></div>
          <div className="l">awaiting reply</div>
        </div>
        <div className="desk-stat">
          <div className="v">{stats.completed}</div>
          <div className="l">returned</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="filters">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={f.key === "all" ? "/dashboard" : `/dashboard?filter=${f.key}`}
              className={filter === f.key ? "on" : ""}
            >
              {f.label} <span style={{ color: "var(--muted)", fontStyle: "normal", fontSize: 13 }}>· {counts[f.key]}</span>
            </Link>
          ))}
        </div>
        <Link href="/documents/new" className="btn-primary">
          Lay down a new paper <span className="arr">→</span>
        </Link>
      </div>

      {docs.length === 0 ? (
        <div className="empty">
          {filter === "all"
            ? "An empty desk this morning. "
            : `Nothing in this stack just now. `}
          <Link href="/documents/new" style={{ color: "var(--ink)", fontStyle: "normal", borderBottom: "1px solid var(--rule)", paddingBottom: 1 }}>
            Lay down a new paper, perhaps?
          </Link>
        </div>
      ) : (
        <div className="desk">
          {docs.map((d) => (
            <Link key={d.id} href={`/documents/${d.id}`} className="letter">
              <div className="letter-head">
                <span className="stamp">
                  {d.status === "draft" ? "drafted " : "stamped "}
                  {new Date(d.createdAt).toLocaleDateString("en-GB", STAMP_FORMAT)}
                </span>
                <span className="ref">{d.kind === "html" ? "HTML form" : "PDF"}</span>
              </div>
              <h3>{d.title}</h3>
              <div className="sub">{statusSubLabel(d.status)}</div>
              <div className="footer-row">
                <div className="recipients-text">— from your desk</div>
                <div className={`seal ${sealClass(d.status)}`}>{statusLabel(d.status)}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
