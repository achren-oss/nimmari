import { randomBytes } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user, account } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getAgentIdentity } from "@/lib/api-auth";
import { id } from "@/lib/ids";

export async function POST(req: Request) {
  const caller = await getAgentIdentity(req);
  if (caller.error) return caller.error;
  if (caller.identity.scope !== "admin") return Response.json({ error: "Admin scope required" }, { status: 403 });
  const context = await auth.$context;
  const input = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()), name: z.string().trim().min(1).max(5000), password: z.string().min(context.password.config.minPasswordLength).max(context.password.config.maxPasswordLength).optional() }).safeParse(await req.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Invalid email, name or password" }, { status: 400 });
  const { email, name } = input.data;
  if (await db.query.user.findFirst({ where: eq(user.email, email) })) return Response.json({ error: "Email already exists" }, { status: 409 });
  const password = input.data.password ?? randomBytes(24).toString("base64url");
  const hash = await context.password.hash(password);
  const userId = id("user");
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(user).values({ id: userId, email, name, emailVerified: false, createdAt: now, updatedAt: now });
      await tx.insert(account).values({ id: id("acct"), userId, accountId: userId, providerId: "credential", password: hash, createdAt: now, updatedAt: now });
    });
  } catch (error) {
    // Resolve concurrent duplicate provisioning without swallowing other DB errors.
    if (await db.query.user.findFirst({ where: eq(user.email, email) })) return Response.json({ error: "Email already exists" }, { status: 409 });
    throw error;
  }
  return Response.json({ id: userId, email, name, ...(input.data.password === undefined ? { password } : {}) }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
