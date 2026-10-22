import { Suspense } from "react";
import { ChatShell } from "@/components/chat/ChatShell";

async function Conversation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChatShell key={id} initialConversationId={id} />;
}

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<ChatShell initialConversationId={null} />}>
      <Conversation params={params} />
    </Suspense>
  );
}
