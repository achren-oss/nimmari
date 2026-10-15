import { randomBytes } from "node:crypto";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { user, account } from "@/db/schema";
import { id } from "@/lib/ids";

export async function prepareAccount(body: unknown) {
  const context = await auth.$context;
  const input = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()), name: z.string().trim().min(1).max(5000), password: z.string().min(context.password.config.minPasswordLength).max(context.password.config.maxPasswordLength).optional() }).safeParse(body);
  if (!input.success) return null;
  const { email, name } = input.data;
  const password = input.data.password ?? randomBytes(24).toString("base64url");
  const hash = await context.password.hash(password);
  const userId = id("user");
  const now = new Date();
  return {
    result: { id: userId, email, name, ...(input.data.password === undefined ? { password } : {}) },
    async insert(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
      await tx.insert(user).values({ id: userId, email, name, emailVerified: false, createdAt: now, updatedAt: now });
      await tx.insert(account).values({ id: id("acct"), userId, accountId: userId, providerId: "credential", password: hash, createdAt: now, updatedAt: now });
    },
  };
}
