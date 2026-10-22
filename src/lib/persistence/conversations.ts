import "server-only";
import type { ChatEvent } from "@/lib/ai/orchestrator";
import type { HistoryTurn } from "@/lib/ai/router";
import { query, queryOne, transaction } from "@/lib/db";
import type { EvidenceSource } from "@/lib/retrieval/types";

export type ConversationSummary = { id: string; title: string; updated_at: string };

export type StoredSource = EvidenceSource & { cited: boolean };

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "complete" | "error";
  categories: string[];
  followups: string[];
  retrieval: Record<string, unknown>;
  error: string | null;
  created_at: string;
  sources: StoredSource[];
  rating: number | null;
};

export async function listConversations(visitorId: string, limit = 30): Promise<ConversationSummary[]> {
  return query<ConversationSummary>(
    "select id, title, updated_at from conversations where visitor_id = $1 order by updated_at desc limit $2",
    [visitorId, limit],
  );
}

export async function getOwnedConversation(id: string, visitorId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return queryOne<{ id: string; title: string }>("select id, title from conversations where id = $1 and visitor_id = $2", [id, visitorId]);
}

export async function createConversation(visitorId: string, firstMessage: string) {
  const title = firstMessage.replace(/\s+/g, " ").trim().slice(0, 70) || "New conversation";
  return (await queryOne<{ id: string; title: string }>("insert into conversations (visitor_id, title) values ($1, $2) returning id, title", [visitorId, title]))!;
}

export async function deleteConversation(id: string, visitorId: string) {
  await query("delete from conversations where id = $1 and visitor_id = $2", [id, visitorId]);
}

export async function renameConversation(id: string, visitorId: string, title: string) {
  await query("update conversations set title = $3 where id = $1 and visitor_id = $2", [id, visitorId, title.slice(0, 120)]);
}

export async function loadHistory(conversationId: string): Promise<HistoryTurn[]> {
  const rows = await query<{ role: "user" | "assistant"; content: string }>(
    `select role, content from messages where conversation_id = $1 and status = 'complete' order by created_at desc limit 16`,
    [conversationId],
  );
  const turns = rows.reverse();
  // The API expects alternating turns starting with the user.
  const out: HistoryTurn[] = [];
  for (const t of turns) {
    if (!out.length && t.role !== "user") continue;
    if (out.length && out[out.length - 1].role === t.role) out[out.length - 1] = t;
    else out.push(t);
  }
  if (out.length && out[out.length - 1].role === "user") out.pop();
  return out;
}

export async function loadMessages(conversationId: string, visitorId: string): Promise<StoredMessage[]> {
  const messages = await query<Omit<StoredMessage, "sources" | "rating">>(
    `select id, role, content, status, categories, followups, retrieval, error, created_at
     from messages where conversation_id = $1 order by created_at asc`,
    [conversationId],
  );
  if (!messages.length) return [];
  const ids = messages.map((m) => m.id);
  const sources = await query<{
    message_id: string; ref: number; kind: "kb" | "web"; url: string; title: string; publisher: string | null; published_at: Date | null;
    retrieved_at: Date; trust: EvidenceSource["trust"]; snippet: string; document_id: string | null; chunk_id: string | null; score: number | null; cited: boolean;
  }>("select * from message_sources where message_id = any($1) order by ref", [ids]);
  const ratings = await query<{ message_id: string; rating: number }>("select message_id, rating from feedback where message_id = any($1) and visitor_id = $2", [ids, visitorId]);
  const ratingBy = new Map(ratings.map((r) => [r.message_id, r.rating]));
  return messages.map((m) => ({
    ...m,
    rating: ratingBy.get(m.id) ?? null,
    sources: sources
      .filter((s) => s.message_id === m.id)
      .map((s) => ({
        ref: s.ref,
        kind: s.kind,
        url: s.url,
        title: s.title,
        publisher: s.publisher,
        publishedAt: s.published_at ? new Date(s.published_at).toISOString() : null,
        retrievedAt: new Date(s.retrieved_at).toISOString(),
        trust: s.trust,
        snippet: s.snippet,
        documentId: s.document_id,
        chunkId: s.chunk_id,
        score: s.score ?? 0,
        flags: [],
        cited: s.cited,
      })),
  }));
}

export async function insertUserMessage(conversationId: string, content: string) {
  await query("insert into messages (conversation_id, role, content) values ($1, 'user', $2)", [conversationId, content]);
  await query("update conversations set updated_at = now() where id = $1", [conversationId]);
}

export async function createAssistantPlaceholder(conversationId: string) {
  return (await queryOne<{ id: string }>("insert into messages (conversation_id, role, status) values ($1, 'assistant', 'streaming') returning id", [conversationId]))!.id;
}

export async function finalizeAssistantMessage(
  messageId: string,
  result: { plan?: Extract<ChatEvent, { type: "plan" }>; sources: EvidenceSource[]; done?: Extract<ChatEvent, { type: "done" }>; error?: string; partialText: string },
) {
  await transaction(async (client) => {
    const cited = new Set(result.done?.citations.cited ?? []);
    await client.query(
      `update messages set content = $2, status = $3, categories = $4, model = $5, prompt_version = $6, retrieval = $7, followups = $8, usage = $9, error = $10
       where id = $1`,
      [
        messageId,
        result.done?.text ?? result.partialText,
        result.done ? "complete" : "error",
        result.plan?.plan.categories ?? [],
        result.done?.model ?? null,
        result.done?.promptVersion ?? null,
        JSON.stringify({
          plan: result.plan?.plan ?? null,
          status: result.plan?.status ?? null,
          invalidCitations: result.done?.citations.invalid ?? [],
          weakCitations: result.done?.citations.weak ?? [],
          unverifiedUrls: result.done?.citations.unverifiedUrls ?? [],
          redacted: result.done?.redacted ?? [],
        }),
        JSON.stringify(result.done?.followups ?? []),
        JSON.stringify(result.done?.usage ?? {}),
        result.error ?? null,
      ],
    );
    for (const s of result.sources) {
      await client.query(
        `insert into message_sources (message_id, ref, kind, document_id, chunk_id, url, title, publisher, published_at, retrieved_at, trust, snippet, score, cited)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) on conflict (message_id, ref) do nothing`,
        [messageId, s.ref, s.kind, s.documentId, s.chunkId, s.url, s.title, s.publisher, s.publishedAt, s.retrievedAt, s.trust, s.snippet, s.score, cited.has(s.ref)],
      );
    }
    if (result.plan) {
      await client.query(
        `insert into retrieval_events (message_id, query, used_kb, used_live, kb_results, web_results, latency_ms)
         values ($1, $2, $3, $4, $5, $6, 0)`,
        [
          messageId,
          result.plan.plan.search_query,
          result.plan.status.knowledgeBase.searched,
          result.plan.status.liveSearch.used,
          result.plan.status.knowledgeBase.results,
          result.plan.status.liveSearch.results,
        ],
      );
    }
  });
}

export async function setFeedback(messageId: string, visitorId: string, rating: 1 | -1 | 0, comment: string | null) {
  const owned = await queryOne(
    `select m.id from messages m join conversations c on c.id = m.conversation_id where m.id = $1 and c.visitor_id = $2 and m.role = 'assistant'`,
    [messageId, visitorId],
  );
  if (!owned) return false;
  if (rating === 0) await query("delete from feedback where message_id = $1 and visitor_id = $2", [messageId, visitorId]);
  else
    await query(
      `insert into feedback (message_id, visitor_id, rating, comment) values ($1, $2, $3, $4)
       on conflict (message_id, visitor_id) do update set rating = excluded.rating, comment = coalesce(excluded.comment, feedback.comment), created_at = now()`,
      [messageId, visitorId, rating, comment],
    );
  return true;
}
