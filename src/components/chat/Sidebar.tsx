"use client";

import Link from "next/link";
import { BookOpen, LayoutDashboard, MessageSquarePlus, MessagesSquare, Trash2, X } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import type { ConversationSummary, FeatureStatus } from "./types";

type Props = {
  conversations: ConversationSummary[];
  activeId: string | null;
  features: FeatureStatus | null;
  open: boolean;
  onClose: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
};

function groupLabel(iso: string): string {
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (days < 1) return "Today";
  if (days < 7) return "Previous 7 days";
  if (days < 30) return "Previous 30 days";
  return "Older";
}

export function Sidebar({ conversations, activeId, features, open, onClose, onNew, onOpen, onDelete }: Props) {
  const groups = new Map<string, ConversationSummary[]>();
  for (const c of conversations) {
    const label = groupLabel(c.updated_at);
    groups.set(label, [...(groups.get(label) ?? []), c]);
  }

  return (
    <>
      <div className={`fixed inset-0 z-30 bg-charcoal/40 transition-opacity lg:hidden ${open ? "opacity-100" : "pointer-events-none opacity-0"}`} onClick={onClose} aria-hidden="true" />
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col bg-forest-900 text-white/90 transition-transform duration-200 lg:static lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
        aria-label="Sidebar"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <button onClick={onNew} className="rounded-md" aria-label="ZecWise home">
            <Logo />
          </button>
          <button onClick={onClose} className="rounded-md p-1.5 text-white/70 hover:bg-white/10 lg:hidden" aria-label="Close sidebar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-3">
          <button
            onClick={onNew}
            className="flex w-full items-center gap-2.5 rounded-lg border border-white/15 px-3 py-2.5 text-sm font-medium text-white transition hover:border-white/25 hover:bg-white/[0.06]"
          >
            <MessageSquarePlus className="h-4 w-4" />
            New chat
          </button>
        </div>

        <nav className="mt-5 flex-1 overflow-y-auto px-3 pb-4" aria-label="Recent conversations">
          {!features?.database && features && (
            <p className="px-2 text-xs leading-relaxed text-white/50">Conversation history is off because no database is configured on this server.</p>
          )}
          {features?.database && conversations.length === 0 && <p className="px-2 text-xs text-white/50">Your conversations will appear here.</p>}
          {[...groups.entries()].map(([label, items]) => (
            <div key={label} className="mb-4">
              <p className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-white/40">{label}</p>
              <ul className="space-y-0.5">
                {items.map((c) => (
                  <li key={c.id} className="group relative">
                    <button
                      onClick={() => onOpen(c.id)}
                      className={`w-full truncate rounded-md px-2 py-2 pr-8 text-left text-sm transition ${c.id === activeId ? "bg-white/[0.1] text-white" : "text-white/75 hover:bg-white/[0.06] hover:text-white"}`}
                      title={c.title}
                    >
                      {c.title}
                    </button>
                    <button
                      onClick={() => onDelete(c.id)}
                      className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-white/40 opacity-0 transition group-hover:opacity-100 hover:bg-white/10 hover:text-white focus:opacity-100"
                      aria-label={`Delete conversation "${c.title}"`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 px-3 py-3 text-sm">
          <Link href="/" onClick={(e) => { e.preventDefault(); onNew(); }} className="flex items-center gap-2.5 rounded-md px-2 py-2 text-white/75 hover:bg-white/[0.06] hover:text-white">
            <MessagesSquare className="h-4 w-4" /> Chat
          </Link>
          <Link href="/about" className="flex items-center gap-2.5 rounded-md px-2 py-2 text-white/75 hover:bg-white/[0.06] hover:text-white">
            <BookOpen className="h-4 w-4" /> How ZecWise works
          </Link>
          <Link href="/admin" className="flex items-center gap-2.5 rounded-md px-2 py-2 text-white/75 hover:bg-white/[0.06] hover:text-white">
            <LayoutDashboard className="h-4 w-4" /> Knowledge admin
          </Link>
        </div>
      </aside>
    </>
  );
}
