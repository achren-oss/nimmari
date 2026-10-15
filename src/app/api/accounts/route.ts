import { prepareAccount } from "@/lib/provision-account";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import { getAgentIdentity } from "@/lib/api-auth";

export async function POST(req: Request) {
  const caller = await getAgentIdentity(req);
  if (caller.error) return caller.error;
  if (caller.identity.scope !== "admin") return Response.json({ error: "Admin scope required" }, { status: 403 });
  const prepared = await prepareAccount(await req.json().catch(() => null));
  if (!prepared) return Response.json({ error: "Invalid email, name or password" }, { status: 400 });
  try {
    await db.transaction(prepared.insert);
  } catch (error) {
    if (await db.query.user.findFirst({ where: eq(user.email, prepared.result.email) })) return Response.json({ error: "Email already exists" }, { status: 409 });
    throw error;
  }
  return Response.json(prepared.result, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: Request) {
  const caller = await getAgentIdentity(req);
  if (caller.error) return caller.error;
  if (caller.identity.scope !== "admin") return Response.json({ error: "Admin scope required" }, { status: 403 });
  const email = new URL(req.url).searchParams.get("email");
  const rows = await db.select({ id: user.id, email: user.email, name: user.name, createdAt: user.createdAt, disabledAt: user.disabledAt })
    .from(user).where(email === null ? undefined : eq(user.email, email.trim().toLowerCase()))
    .orderBy(asc(user.createdAt), asc(user.id));
  return Response.json({ accounts: rows.map(({ disabledAt, ...row }) => ({ ...row, disabled: disabledAt !== null })) }, { headers: { "Cache-Control": "no-store" } });
}
