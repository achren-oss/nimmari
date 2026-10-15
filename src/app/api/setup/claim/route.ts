import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { apiKey, setupClaim, user } from "@/db/schema";
import { nimmariEnv } from "@/lib/env";
import { appUrl } from "@/lib/app-url";
import { generateApiKey } from "@/lib/api-keys";
import { prepareAccount } from "@/lib/provision-account";
import { FixedWindowLimiter, clientIp } from "@/lib/rate-limit";
import { id } from "@/lib/ids";

const limiter = new FixedWindowLimiter(undefined, 600_000, true);
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const enabledCode = () => {
  const code = nimmariEnv("SETUP_CODE");
  return code && code.length >= 32 ? code : null;
};
export async function GET() {
  return reply({ enabled: !!enabledCode(), claimed: !!await db.query.setupClaim.findFirst() });
}
export async function POST(req: Request) {
  const code = enabledCode();
  if (!code) return reply({ error: "Not found" }, 404);
  const limited = await limiter.check(`setup:${clientIp(req)}`, 10);
  if (limited) {
    limited.headers.set("Cache-Control", "no-store");
    return limited;
  }
  const body = await req.json().catch(() => null);
  const hash = (value: string) => createHash("sha256").update(value).digest();
  if (typeof body?.setupCode !== "string" || !timingSafeEqual(hash(body.setupCode), hash(code))) return reply({ error: "Invalid setup code" }, 403);
  if (await db.query.setupClaim.findFirst()) return reply({ error: "already_claimed" }, 410);
  const prepared = await prepareAccount(body);
  if (!prepared) return reply({ error: "Invalid email, name or password" }, 400);
  const makeKey = (scope: "admin" | "regular") => {
    const generated = generateApiKey();
    return { id: id("key"), scope, ...generated };
  };
  const adminKey = makeKey("admin");
  const agentKey = makeKey("regular");
  try {
    const outcome = await db.transaction(async (tx) => {
      // The write lock and primary key serialize claims across processes.
      if (await tx.query.setupClaim.findFirst()) return "claimed";
      if (await tx.select({ id: user.id }).from(user).limit(1).then(rows => rows.length)) {
        throw new Error("setup_accounts_exist");
      }
      const inserted = await tx.insert(setupClaim).values({ id: "initial", claimedAt: new Date(), userId: prepared.result.id }).onConflictDoNothing().returning();
      if (!inserted.length) return "claimed";
      await prepared.insert(tx);
      for (const key of [adminKey, agentKey]) {
        await tx.insert(apiKey).values({ id: key.id, scope: key.scope, name: key.scope === "admin" ? "Server admin" : "Document agent", ownerUserId: prepared.result.id, keyHash: key.keyHash, keyPrefix: key.keyPrefix, createdAt: new Date() });
      }
      return "created";
    });
    if (outcome === "claimed") return reply({ error: "already_claimed" }, 410);
  } catch (error) {
    if (error instanceof Error && error.message === "setup_accounts_exist") return reply({ error: "Instance already has accounts" }, 409);
    // Never expose driver errors, SQL parameters, setup codes or keys.
    return reply({ error: "Setup failed; retry" }, 500);
  }
  const { password, ...account } = prepared.result;
  const publicKey = ({ id, key, scope }: typeof adminKey) => ({ id, key, scope });
  return reply({ account, ...(password === undefined ? {} : { password }), adminKey: publicKey(adminKey), agentKey: publicKey(agentKey), baseUrl: appUrl() }, 201);
}
