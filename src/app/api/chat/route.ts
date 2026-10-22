import { z } from "zod";
import { runConversation, type ChatEvent } from "@/lib/ai/orchestrator";
import type { HistoryTurn } from "@/lib/ai/router";
import { handle, jsonError } from "@/lib/api";
import { getVisitorId } from "@/lib/auth/visitor";
import { config, featureStatus } from "@/lib/config";
import { errorMessage, log } from "@/lib/log";
import {
  createAssistantPlaceholder,
  createConversation,
  finalizeAssistantMessage,
  getOwnedConversation,
  insertUserMessage,
  loadHistory,
} from "@/lib/persistence/conversations";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import type { EvidenceSource } from "@/lib/retrieval/types";

const Body = z.object({
  conversationId: z.string().uuid().nullish(),
  message: z.string().trim().min(1).max(8000),
  // Only used when no database is configured, so follow-ups still have context.
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20000) }))
    .max(16)
    .optional(),
});

export const maxDuration = 300;

export const POST = handle(async (request: Request) => {
  const limit = rateLimit(`chat:${clientIp(request.headers)}`, config.rateLimit.chatPerMinute);
  if (!limit.ok) return jsonError("You're sending messages too quickly. Please wait a moment.", 429, { retryAfter: limit.retryAfterSeconds });

  const body = Body.parse(await request.json());
  const features = featureStatus();
  if (!features.llm) return jsonError("The AI model is not configured on this server (ANTHROPIC_API_KEY is missing).", 503, { code: "llm_not_configured" });

  let conversationId: string | null = null;
  let assistantId: string | null = null;
  let history: HistoryTurn[] = [];

  if (features.database) {
    const visitorId = (await getVisitorId({ create: true }))!;
    if (body.conversationId) {
      const owned = await getOwnedConversation(body.conversationId, visitorId);
      if (!owned) return jsonError("Conversation not found.", 404);
      conversationId = owned.id;
      history = await loadHistory(conversationId);
    } else {
      conversationId = (await createConversation(visitorId, body.message)).id;
    }
    await insertUserMessage(conversationId, body.message);
    assistantId = await createAssistantPlaceholder(conversationId);
  } else {
    history = body.history ?? [];
  }

  const encoder = new TextEncoder();
  const generator = runConversation({ message: body.message, history });
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent | { type: "meta"; conversationId: string | null; messageId: string | null }) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      send({ type: "meta", conversationId, messageId: assistantId });

      let plan: Extract<ChatEvent, { type: "plan" }> | undefined;
      let done: Extract<ChatEvent, { type: "done" }> | undefined;
      let sources: EvidenceSource[] = [];
      let partial = "";
      let error: string | undefined;
      try {
        for await (const event of generator) {
          if (cancelled) break;
          if (event.type === "plan") plan = event;
          else if (event.type === "sources") sources = event.sources;
          else if (event.type === "delta") partial += event.text;
          else if (event.type === "done") done = event;
          else if (event.type === "error") error = event.message;
          send(event);
        }
      } catch (err) {
        error = "Something went wrong while generating the answer.";
        log("error", "chat.stream_failed", { error: errorMessage(err) });
        try {
          send({ type: "error", message: error, code: "internal" });
        } catch {
          /* stream already closed */
        }
      }
      if (cancelled && !done) error = "Generation stopped before it finished.";
      if (assistantId) {
        await finalizeAssistantMessage(assistantId, { plan, sources, done, error, partialText: partial }).catch((err) =>
          log("error", "chat.persist_failed", { error: errorMessage(err) }),
        );
      }
      try {
        controller.close();
      } catch {
        /* client went away */
      }
    },
    async cancel() {
      cancelled = true;
      await generator.return(undefined);
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
});
