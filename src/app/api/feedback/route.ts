import { z } from "zod";
import { handle, jsonError } from "@/lib/api";
import { getVisitorId } from "@/lib/auth/visitor";
import { setFeedback } from "@/lib/persistence/conversations";

const Body = z.object({
  messageId: z.string().uuid(),
  rating: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
  comment: z.string().trim().max(2000).nullish(),
});

export const POST = handle(async (req: Request) => {
  const body = Body.parse(await req.json());
  const visitorId = await getVisitorId({ create: false });
  if (!visitorId) return jsonError("Message not found.", 404);
  const ok = await setFeedback(body.messageId, visitorId, body.rating, body.comment ?? null);
  return ok ? Response.json({ ok: true }) : jsonError("Message not found.", 404);
});
