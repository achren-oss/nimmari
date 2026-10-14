import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apiKey, user } from "@/db/schema";
import { getAgentIdentity } from "@/lib/api-auth";
import { generateApiKey } from "@/lib/api-keys";
import { id } from "@/lib/ids";

const keyColumns = { id: apiKey.id, name: apiKey.name, scope: apiKey.scope, ownerUserId: apiKey.ownerUserId, prefix: apiKey.keyPrefix, createdAt: apiKey.createdAt, lastUsedAt: apiKey.lastUsedAt, revokedAt: apiKey.revokedAt };

export async function POST(req: Request) {
  const caller = await getAgentIdentity(req);
  if (caller.error) return caller.error;
  const input = z.object({ name: z.string().trim().min(1).max(200), scope: z.enum(["admin", "regular"]).default("regular"), ownerUserId: z.string().min(1).optional() }).safeParse(await req.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Invalid name, scope or ownerUserId" }, { status: 400 });
  const { identity } = caller;
  const { name, scope } = input.data;
  const ownerUserId = input.data.ownerUserId ?? identity.userId;
  if (identity.scope !== "admin" && (scope !== "regular" || ownerUserId !== identity.userId)) return Response.json({ error: "Cannot create this key" }, { status: 403 });
  if (!ownerUserId) return Response.json({ error: "ownerUserId required for ownerless root" }, { status: 400 });
  if (!await db.query.user.findFirst({ where: eq(user.id, ownerUserId) })) return Response.json({ error: "Owner not found" }, { status: 404 });
  const generated = generateApiKey();
  const row = { id: id("key"), name, scope, ownerUserId, createdAt: new Date() };
  await db.insert(apiKey).values({ ...row, keyHash: generated.keyHash, keyPrefix: generated.keyPrefix });
  return Response.json({ ...row, prefix: generated.keyPrefix, key: generated.key }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: Request) {
  const caller = await getAgentIdentity(req);
  if (caller.error) return caller.error;
  const owner = caller.identity.scope === "admin" ? new URL(req.url).searchParams.get("ownerUserId") : caller.identity.userId;
  const rows = await db.select(keyColumns).from(apiKey).where(owner ? eq(apiKey.ownerUserId, owner) : undefined);
  return Response.json({ keys: rows }, { headers: { "Cache-Control": "no-store" } });
}
