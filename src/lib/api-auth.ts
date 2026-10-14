import { bearerFailureRateLimit } from "@/lib/rate-limit";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { apiKey } from "@/db/schema";
import { getServerSession } from "@/lib/session";
import { hashApiKey, matchesRootKey } from "@/lib/api-keys";

const failures = new WeakMap<Request, Response>();
async function bearerFailure(req: Request): Promise<null> {
  failures.set(req, await bearerFailureRateLimit(req) ?? Response.json({ error: "Unauthorized" }, { status: 401 }));
  return null;
}
export function authenticationFailure(req: Request): Response {
  return failures.get(req) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
}

export interface ApiIdentity {
  userId: string;
  scope?: "admin" | "regular";
  keyId?: string;
  via: "session" | "root" | "key";
}

/** Bearer failures never fall through to cookies. Ownerless roots are admin-only. */
export async function getApiIdentity(req: Request, options: { allowOwnerlessRoot?: boolean } = {}): Promise<ApiIdentity | null> {
  const header = req.headers.get("authorization");
  if (header !== null) {
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (!match) return bearerFailure(req);
    const key = match[1];
    if (matchesRootKey(key)) {
      const userId = process.env.PUUMERKKI_API_OWNER_ID || "";
      return userId || options.allowOwnerlessRoot ? { userId, scope: "admin", via: "root" } : bearerFailure(req);
    }
    const row = await db.query.apiKey.findFirst({ where: and(eq(apiKey.keyHash, hashApiKey(key)), isNull(apiKey.revokedAt)) });
    if (!row) return bearerFailure(req);
    try { await db.update(apiKey).set({ lastUsedAt: new Date() }).where(eq(apiKey.id, row.id)); } catch { /* Usage tracking must not prevent authentication. */ }
    return { userId: row.ownerUserId, scope: row.scope, keyId: row.id, via: "key" };
  }
  const session = await getServerSession();
  return session?.user ? { userId: session.user.id, scope: "regular", via: "session" } : null;
}

export async function getAgentIdentity(req: Request) {
  const identity = await getApiIdentity(req, { allowOwnerlessRoot: true });
  if (!identity) return { error: authenticationFailure(req) };
  if (identity.via === "session") return { error: Response.json({ error: "API key required" }, { status: 403 }) };
  return { identity };
}
