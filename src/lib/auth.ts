import { authBaseUrl } from "@/lib/app-url";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { user } from "@/db/schema";
import { eq } from "drizzle-orm";
import { APIError } from "better-auth/api";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
  },
  // Block implicit account creation by any future auth provider as well.
  databaseHooks: {
    user: { create: { before: async () => false } },
    session: { create: { before: async (session) => {
      const owner = await db.query.user.findFirst({ where: eq(user.id, session.userId) });
      if (!owner || owner.disabledAt !== null) {
        throw new APIError("FORBIDDEN", { message: "Account disabled" });
      }
    } } },
  },
  user: {
    additionalFields: {
      signaturePng: {
        type: "string",
        required: false,
        input: true,
      },
    },
  },
  advanced: { ipAddress: { ipAddressHeaders: ["x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"] } },
  rateLimit: {
    storage: "database",
    enabled: true,
    window: 60,
    max: 30,
    customRules: {
      "/sign-up/email": { window: 600, max: 5 },
      "/sign-in/email": { window: 60, max: 8 },
    },
  },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: authBaseUrl(),
  ...(process.env.RENDER_EXTERNAL_URL ? { trustedOrigins: [process.env.RENDER_EXTERNAL_URL] } : {}),
});

export type Session = typeof auth.$Infer.Session;
