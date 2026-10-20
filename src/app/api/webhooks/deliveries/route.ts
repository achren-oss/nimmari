import { getAgentIdentity } from "@/lib/api-auth";
import { deliveryHistory } from "@/lib/webhook-outbox";
export async function GET(req: Request) {
  const auth = await getAgentIdentity(req);
  if (auth.error) return auth.error;
  return deliveryHistory(req, auth.identity.userId);
}
