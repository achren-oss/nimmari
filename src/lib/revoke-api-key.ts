import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { apiKey } from "@/db/schema";
import { getAgentIdentity } from "@/lib/api-auth";

export async function revokeApiKey(req: Request, keyId: string) {
  const caller = await getAgentIdentity(req);
  if (caller.error) return caller.error;
  const condition = caller.identity.scope === "admin" ? eq(apiKey.id, keyId) : and(eq(apiKey.id, keyId), eq(apiKey.ownerUserId, caller.identity.userId));
  const row = await db.query.apiKey.findFirst({ where: condition });
  if (!row) return Response.json({ error: "Key not found" }, { status: 404 });
  await db.update(apiKey).set({ revokedAt: new Date() }).where(and(condition, isNull(apiKey.revokedAt)));
  return Response.json({ ok: true });
}
