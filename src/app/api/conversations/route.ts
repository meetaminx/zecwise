import { handle } from "@/lib/api";
import { getVisitorId } from "@/lib/auth/visitor";
import { featureStatus } from "@/lib/config";
import { listConversations } from "@/lib/persistence/conversations";

export const GET = handle(async () => {
  if (!featureStatus().database) return Response.json({ conversations: [], persistence: false });
  const visitorId = await getVisitorId({ create: false });
  if (!visitorId) return Response.json({ conversations: [], persistence: true });
  return Response.json({ conversations: await listConversations(visitorId), persistence: true });
});
