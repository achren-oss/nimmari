import { revokeApiKey } from "@/lib/revoke-api-key";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return revokeApiKey(req, (await params).id);
}
