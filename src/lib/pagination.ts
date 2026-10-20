export function pageQuery(url: string) {
  const q = new URL(url).searchParams;
  const raw = q.get("limit") ?? "20";
  if (!/^\d+$/.test(raw) || +raw < 1 || +raw > 100) throw new Error("Invalid limit");
  let cursor: { time: number; id: string } | null = null;
  if (q.has("cursor")) {
    try {
      const encoded = q.get("cursor")!;
      if (encoded.length > 1024) throw new Error();
      const value = JSON.parse(Buffer.from(encoded, "base64url").toString());
      if (Buffer.from(JSON.stringify(value)).toString("base64url") !== encoded || !Number.isSafeInteger(value.time) || value.time < 0 || typeof value.id !== "string" || !value.id || value.id.length > 255) throw new Error();
      cursor = value;
    } catch { throw new Error("Invalid cursor"); }
  }
  return { q, limit: +raw, cursor };
}
export const encodeCursor = (row: { createdAt: Date; id: string }) => Buffer.from(JSON.stringify({ time: row.createdAt.getTime(), id: row.id })).toString("base64url");
