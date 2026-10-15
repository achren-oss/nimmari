import { nimmariEnv } from "@/lib/env";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { account, apiKey, document, session, user } from "@/db/schema";
import { getAgentIdentity } from "@/lib/api-auth";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getAgentIdentity(req);
  if (caller.error) return caller.error;
  if (caller.identity.scope !== "admin") return Response.json({ error: "Admin scope required" }, { status: 403 });
  const { id } = await params;
  // Keep the ownership check and all mutations in the same write transaction.
  return db.transaction(async (tx) => {
    const owner = await tx.query.user.findFirst({ where: eq(user.id, id) });
    if (!owner) return Response.json({ error: "Account not found" }, { status: 404 });
    if (id === nimmariEnv("API_OWNER_ID") || id === caller.identity.userId) {
      return Response.json({ error: "Cannot delete the configured API owner or your own account" }, { status: 409 });
    }
    if (await tx.query.document.findFirst({ where: eq(document.ownerId, id) })) {
      return Response.json({ error: "Cannot delete an account that owns documents" }, { status: 409 });
    }
    await tx.update(apiKey).set({ revokedAt: new Date() }).where(eq(apiKey.ownerUserId, id));
    await tx.delete(session).where(eq(session.userId, id));
    await tx.delete(account).where(eq(account.userId, id));
    // The API key foreign key cascades after revocation. Documents are never deleted.
    await tx.delete(user).where(eq(user.id, id));
    return Response.json({ ok: true, id });
  });
}
