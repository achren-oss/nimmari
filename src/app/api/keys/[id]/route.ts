import { revokeApiKey } from "@/lib/revoke-api-key";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return revokeApiKey(req, (await params).id);
}
