"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, CitationInfo, ConversationSummary, FeatureStatus, Source } from "./types";

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()));

type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  categories: string[];
  followups: string[];
  retrieval: { status?: ChatMessage["status"]; invalidCitations?: number[]; weakCitations?: CitationInfo["weak"]; unverifiedUrls?: string[]; redacted?: string[] };
  error: string | null;
  sources: Source[];
  rating: number | null;
};

function fromStored(m: StoredMessage): ChatMessage {
  return {
    localId: m.id,
    id: m.id,
    role: m.role,
    content: m.content,
    phase: m.role === "assistant" ? (m.status === "complete" ? "done" : "error") : undefined,
    sources: m.sources,
    followups: m.followups,
    categories: m.categories,
    status: m.retrieval?.status ?? undefined,
    citations: m.role === "assistant"
      ? { cited: m.sources.filter((s) => s.cited).map((s) => s.ref), invalid: m.retrieval?.invalidCitations ?? [], weak: m.retrieval?.weakCitations ?? [], unverifiedUrls: m.retrieval?.unverifiedUrls ?? [] }
      : undefined,
    error: m.status === "error" ? m.error ?? "This answer did not finish." : null,
    rating: m.rating,
    redacted: m.retrieval?.redacted,
  };
}

export function useChat(initialConversationId: string | null) {
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [features, setFeatures] = useState<FeatureStatus | null>(null);
  const [loadingConversation, setLoadingConversation] = useState(Boolean(initialConversationId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const refreshConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations", { cache: "no-store" });
      if (res.ok) setConversations((await res.json()).conversations ?? []);
    } catch {
      /* sidebar stays as is */
    }
  }, []);

  useEffect(() => {
    fetch("/api/status", { cache: "no-store" })
      .then((r) => r.json())
      .then(setFeatures)
      .catch(() => setFeatures(null));
    // Initial data load from the server; state is only set when the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshConversations();
  }, [refreshConversations]);

  const openConversation = useCallback(async (id: string | null) => {
    abortRef.current?.abort();
    setConversationId(id);
    setLoadError(null);
    if (!id) {
      setMessages([]);
      setLoadingConversation(false);
      window.history.pushState(null, "", "/");
      return;
    }
    if (window.location.pathname !== `/c/${id}`) window.history.pushState(null, "", `/c/${id}`);
    setLoadingConversation(true);
    try {
      const res = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 404 ? "This conversation doesn't exist or belongs to another browser." : "Couldn't load this conversation.");
      const data = await res.json();
      setMessages((data.messages as StoredMessage[]).map(fromStored));
    } catch (err) {
      setMessages([]);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this conversation.");
    } finally {
      setLoadingConversation(false);
    }
  }, []);

  useEffect(() => {
    // Loading a deep-linked conversation is a fetch on mount, not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialConversationId) void openConversation(initialConversationId);
    const onPop = () => {
      const match = window.location.pathname.match(/^\/c\/([0-9a-f-]{36})$/i);
      void openConversation(match ? match[1] : null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [initialConversationId, openConversation]);

  const patchAssistant = (localId: string, patch: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>)) =>
    setMessages((prev) => prev.map((m) => (m.localId === localId ? { ...m, ...(typeof patch === "function" ? patch(m) : patch) } : m)));

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || streaming) return;
      const userMsg: ChatMessage = { localId: uid(), id: null, role: "user", content: message };
      const assistant: ChatMessage = { localId: uid(), id: null, role: "assistant", content: "", phase: "planning", sources: [], followups: [] };
      // Without a database the server is stateless, so send recent turns for context.
      const history = messages
        .filter((m) => m.content && (m.role === "user" || m.phase === "done"))
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content }));
      setMessages((prev) => [...prev, userMsg, assistant]);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId, message, history: features?.database ? undefined : history }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          patchAssistant(assistant.localId, { phase: "error", error: data.error ?? `Request failed (HTTP ${res.status}).`, errorCode: data.code });
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            const event = JSON.parse(line);
            switch (event.type) {
              case "meta":
                if (event.conversationId && event.conversationId !== conversationId) {
                  setConversationId(event.conversationId);
                  window.history.replaceState(null, "", `/c/${event.conversationId}`);
                }
                patchAssistant(assistant.localId, { id: event.messageId });
                break;
              case "plan":
                patchAssistant(assistant.localId, { phase: "retrieving", status: event.status, categories: event.plan.categories });
                break;
              case "sources":
                patchAssistant(assistant.localId, { sources: event.sources, phase: "writing" });
                break;
              case "delta":
                patchAssistant(assistant.localId, (m) => ({ content: m.content + event.text, phase: "writing" }));
                break;
              case "done":
                patchAssistant(assistant.localId, (m) => ({
                  content: event.text,
                  phase: "done",
                  followups: event.followups,
                  citations: event.citations,
                  redacted: event.redacted,
                  sources: (m.sources ?? []).map((s) => ({ ...s, cited: event.citations.cited.includes(s.ref) })),
                }));
                break;
              case "error":
                patchAssistant(assistant.localId, { phase: "error", error: event.message, errorCode: event.code });
                break;
            }
          }
        }
        patchAssistant(assistant.localId, (m) => (m.phase === "done" || m.phase === "error" ? {} : { phase: "error", error: "The connection closed before the answer finished." }));
      } catch (err) {
        if ((err as Error).name === "AbortError") patchAssistant(assistant.localId, (m) => ({ phase: m.content ? "done" : "error", error: m.content ? null : "Stopped." }));
        else patchAssistant(assistant.localId, { phase: "error", error: "Couldn't reach ZecWise. Check your connection and try again." });
      } finally {
        setStreaming(false);
        abortRef.current = null;
        void refreshConversations();
      }
    },
    [conversationId, features?.database, messages, refreshConversations, streaming],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const retryLast = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    setMessages((prev) => {
      const idx = prev.lastIndexOf(lastUser);
      return prev.slice(0, idx);
    });
    // Let state settle before resending.
    setTimeout(() => void send(lastUser.content), 0);
  }, [messages, send]);

  const rate = useCallback(async (msg: ChatMessage, rating: 1 | -1) => {
    if (!msg.id) return;
    const next = msg.rating === rating ? 0 : rating;
    setMessages((prev) => prev.map((m) => (m.localId === msg.localId ? { ...m, rating: next || null } : m)));
    await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: msg.id, rating: next }) }).catch(() => undefined);
  }, []);

  const removeConversation = useCallback(
    async (id: string) => {
      await fetch(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => undefined);
      if (id === conversationId) void openConversation(null);
      void refreshConversations();
    },
    [conversationId, openConversation, refreshConversations],
  );

  return { conversationId, messages, conversations, features, streaming, loadingConversation, loadError, send, stop, retryLast, rate, openConversation, removeConversation };
}
