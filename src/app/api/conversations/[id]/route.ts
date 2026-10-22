import { z } from "zod";
import { handle, jsonError } from "@/lib/api";
import { getVisitorId } from "@/lib/auth/visitor";
import { deleteConversation, getOwnedConversation, loadMessages, renameConversation } from "@/lib/persistence/conversations";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const visitorId = await getVisitorId({ create: false });
  const conversation = visitorId ? await getOwnedConversation(id, visitorId) : null;
  if (!conversation || !visitorId) return jsonError("Conversation not found.", 404);
  return Response.json({ conversation, messages: await loadMessages(id, visitorId) });
});

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { title } = z.object({ title: z.string().trim().min(1).max(120) }).parse(await req.json());
  const visitorId = await getVisitorId({ create: false });
  if (!visitorId || !(await getOwnedConversation(id, visitorId))) return jsonError("Conversation not found.", 404);
  await renameConversation(id, visitorId, title);
  return Response.json({ ok: true });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const visitorId = await getVisitorId({ create: false });
  if (!visitorId) return jsonError("Conversation not found.", 404);
  await deleteConversation(id, visitorId);
  return Response.json({ ok: true });
});
