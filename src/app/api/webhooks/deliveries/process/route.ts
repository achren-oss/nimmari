import { getAgentIdentity } from "@/lib/api-auth";
import { processDeliveries } from "@/lib/webhook-outbox";
export async function POST(req: Request) {
  const auth = await getAgentIdentity(req);
  if (auth.error) return auth.error;
  return Response.json(await processDeliveries(auth.identity.scope === "admin" ? undefined : auth.identity.userId));
}
