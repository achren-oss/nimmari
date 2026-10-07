import { getServerSession } from "@/lib/session";

const API_KEY = process.env.PUUMERKKI_API_KEY;
const API_OWNER_USER_ID = process.env.PUUMERKKI_API_OWNER_ID;

export interface ApiIdentity {
  userId: string;
  via: "session" | "bot";
}

/**
 * Resolves the caller's identity for API routes: either a logged-in web
 * session, or a service account API key supplied as a bearer token
 * mapped to a fixed service-account owner. A bearer header that doesn't
 * match the configured key is rejected outright -- it does not fall
 * through to session auth.
 */
export async function getApiIdentity(req: Request): Promise<ApiIdentity | null> {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const key = authHeader.slice("Bearer ".length).trim();
    if (API_KEY && API_OWNER_USER_ID && key === API_KEY) {
      return { userId: API_OWNER_USER_ID, via: "bot" };
    }
    return null;
  }
  const session = await getServerSession();
  if (session?.user) return { userId: session.user.id, via: "session" };
  return null;
}
