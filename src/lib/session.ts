import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { db } from "@/db";
import { user } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function getServerSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  const owner = await db.query.user.findFirst({ where: eq(user.id, session.user.id) });
  return owner && owner.disabledAt === null ? session : null;
}

export async function requireUser() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");
  return session.user;
}
