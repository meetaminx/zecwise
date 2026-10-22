"use client";

import { AlertCircle, Menu, MessageSquarePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { AssistantMessage } from "./AssistantMessage";
import { Composer, type ComposerHandle } from "./Composer";
import { EmptyState } from "./EmptyState";
import { Sidebar } from "./Sidebar";
import { useChat } from "./useChat";

export function ChatShell({ initialConversationId }: { initialConversationId: string | null }) {
  const chat = useChat(initialConversationId);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const composer = useRef<ComposerHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  const llmMissing = chat.features ? !chat.features.llm : false;

  useEffect(() => {
    const el = scroller.current;
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);

  const newChat = () => {
    void chat.openConversation(null);
    setSidebarOpen(false);
    setTimeout(() => composer.current?.focus(), 0);
  };

  const sendText = (text: string) => {
    pinnedToBottom.current = true;
    void chat.send(text);
  };

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar
        conversations={chat.conversations}
        activeId={chat.conversationId}
        features={chat.features}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNew={newChat}
        onOpen={(id) => {
          void chat.openConversation(id);
          setSidebarOpen(false);
        }}
        onDelete={(id) => void chat.removeConversation(id)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-forest-900 px-3 py-2.5 lg:hidden">
          <button onClick={() => setSidebarOpen(true)} className="rounded-md p-1.5 text-white/80 hover:bg-white/10" aria-label="Open sidebar">
            <Menu className="h-5 w-5" />
          </button>
          <Logo />
          <button onClick={newChat} className="rounded-md p-1.5 text-white/80 hover:bg-white/10" aria-label="New chat">
            <MessageSquarePlus className="h-5 w-5" />
          </button>
        </header>

        {llmMissing && (
          <div className="flex items-start gap-2.5 border-b border-warn/20 bg-warn-soft px-4 py-2.5 text-sm text-warn" role="status">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              <strong className="font-semibold">Setup needed:</strong> the AI model isn&apos;t configured on this server, so ZecWise can&apos;t answer yet. Set{" "}
              <code className="rounded bg-white/60 px-1">ANTHROPIC_API_KEY</code> in the server environment.
            </p>
          </div>
        )}

        <div
          ref={scroller}
          className="flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {chat.loadingConversation ? (
            <div className="mx-auto max-w-3xl space-y-4 px-4 pt-12 sm:px-6" aria-busy="true" aria-label="Loading conversation">
              {[70, 92, 55].map((w) => (
                <div key={w} className="h-4 animate-pulse rounded bg-line motion-reduce:animate-none" style={{ width: `${w}%` }} />
              ))}
            </div>
          ) : chat.loadError ? (
            <div className="mx-auto max-w-xl px-4 pt-[16vh] text-center">
              <p className="text-ink">{chat.loadError}</p>
              <button onClick={newChat} className="mt-4 rounded-lg bg-forest-700 px-4 py-2 text-sm font-medium text-white hover:bg-forest-800">
                Start a new chat
              </button>
            </div>
          ) : chat.messages.length === 0 ? (
            <EmptyState onPick={sendText} disabled={llmMissing || chat.streaming} />
          ) : (
            <div className="mx-auto w-full max-w-3xl space-y-8 px-4 pt-8 pb-6 sm:px-6">
              {chat.messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={m.localId} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-forest-800 px-4 py-2.5 text-[0.95rem] leading-relaxed whitespace-pre-wrap text-white">{m.content}</div>
                  </div>
                ) : (
                  <AssistantMessage
                    key={m.localId}
                    message={m}
                    isLast={i === chat.messages.length - 1}
                    canAct={!chat.streaming && !llmMissing}
                    onFollowup={sendText}
                    onRetry={chat.retryLast}
                    onRate={(r) => void chat.rate(m, r)}
                  />
                ),
              )}
            </div>
          )}
        </div>

        <Composer ref={composer} onSend={sendText} onStop={chat.stop} streaming={chat.streaming} disabled={llmMissing} disabledReason="ZecWise isn't configured yet" />
      </main>
    </div>
  );
}
