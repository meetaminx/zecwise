"use client";

import { AlertTriangle, Check, Copy, RotateCcw, ShieldAlert, ThumbsDown, ThumbsUp } from "lucide-react";
import { useMemo, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { SourceList, hostOf } from "./Sources";
import type { ChatMessage, Source } from "./types";

const MARKER = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()/g;

/** Turns [1, 2] markers that match retrieved sources into cite: links; unknown refs are dropped. */
function linkCitations(text: string, sources: Source[]) {
  const refs = new Set(sources.map((s) => s.ref));
  return text.replace(MARKER, (_m, group: string) => {
    const valid = group.split(",").map((n) => Number(n.trim())).filter((n) => refs.has(n));
    return valid.map((n) => `[${n}](cite:${n})`).join("");
  });
}

function StatusLine({ message }: { message: ChatMessage }) {
  const s = message.status;
  let text = "Thinking about your question…";
  if (message.phase === "retrieving" || (message.phase === "writing" && !message.content)) {
    const parts: string[] = [];
    if (s?.knowledgeBase.searched) parts.push(`${s.knowledgeBase.results} knowledge base passage${s.knowledgeBase.results === 1 ? "" : "s"}`);
    if (s?.liveSearch.used) parts.push(`${s.liveSearch.results} live web result${s.liveSearch.results === 1 ? "" : "s"}`);
    text = parts.length ? `Read ${parts.join(" and ")}. Writing an answer…` : "Writing an answer…";
  }
  return (
    <div className="flex items-center gap-2.5 text-sm text-muted" role="status" aria-live="polite">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-leaf opacity-50 motion-reduce:animate-none" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-leaf" />
      </span>
      {text}
    </div>
  );
}

function RetrievalNote({ message }: { message: ChatMessage }) {
  const s = message.status;
  if (!s || message.phase !== "done") return null;
  const notes: string[] = [];
  if (s.knowledgeBase.searched) notes.push(`Searched the ZecWise knowledge base`);
  if (s.liveSearch.used) notes.push(`searched the web`);
  else if (s.liveSearch.note && /not configured|failed/.test(s.liveSearch.note)) notes.push(`live web search ${s.liveSearch.note.includes("failed") ? "failed" : "is not configured"}`);
  if (!notes.length) return null;
  const sentence = notes.join(", ");
  return <p className="mt-3 text-xs text-subtle">{sentence.charAt(0).toUpperCase() + sentence.slice(1)} · {s.date}</p>;
}

type Props = {
  message: ChatMessage;
  isLast: boolean;
  onFollowup: (q: string) => void;
  onRetry: () => void;
  onRate: (rating: 1 | -1) => void;
  canAct: boolean;
};

export function AssistantMessage({ message, isLast, onFollowup, onRetry, onRate, canAct }: Props) {
  const [copied, setCopied] = useState(false);
  const sources = useMemo(() => message.sources ?? [], [message.sources]);
  const byRef = useMemo(() => new Map(sources.map((s) => [s.ref, s])), [sources]);
  const body = useMemo(() => linkCitations(message.content, sources), [message.content, sources]);
  const done = message.phase === "done";
  const streaming = message.phase === "writing" && !!message.content;

  const copy = async () => {
    const refs = sources.filter((s) => s.cited);
    const text = refs.length ? `${message.content}\n\nSources:\n${refs.map((s) => `[${s.ref}] ${s.title} — ${s.url}`).join("\n")}` : message.content;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group/msg">
      {message.redacted && message.redacted.length > 0 && (
        <div className="mb-3 flex gap-2.5 rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Your message looked like it contained a wallet secret, so ZecWise removed it before processing. If that was real, treat it as compromised and move your funds to a new wallet.</p>
        </div>
      )}

      {!message.content && message.phase !== "error" && message.phase !== "done" && <StatusLine message={message} />}

      {message.content && (
        <div className={`prose-zw ${streaming ? "streaming-caret" : ""}`}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            urlTransform={(url) => (url.startsWith("cite:") ? url : defaultUrlTransform(url))}
            components={{
              a: ({ href, children }) => {
                if (href?.startsWith("cite:")) {
                  const ref = Number(href.slice(5));
                  const s = byRef.get(ref);
                  if (!s) return null;
                  return (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`${s.title} — ${hostOf(s.url)}`}
                      className="mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] -translate-y-px items-center justify-center rounded bg-leaf-soft px-1 align-middle text-[0.68rem] font-semibold text-forest-800 no-underline transition hover:bg-forest-700 hover:text-white"
                    >
                      {ref}
                    </a>
                  );
                }
                return (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                );
              },
            }}
          >
            {body}
          </ReactMarkdown>
        </div>
      )}

      {message.phase === "error" && (
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-sm text-danger" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{message.error ?? "Something went wrong."}</span>
          {isLast && message.errorCode !== "llm_not_configured" && (
            <button onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-md border border-danger/25 bg-white px-2.5 py-1 text-xs font-medium hover:bg-danger-soft">
              <RotateCcw className="h-3 w-3" /> Try again
            </button>
          )}
        </div>
      )}

      {done && message.citations && message.citations.unverifiedUrls.length > 0 && (
        <p className="mt-3 flex gap-2 text-xs text-warn">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          This answer mentions links that were not among the retrieved sources. Verify them before visiting.
        </p>
      )}

      <SourceList sources={sources} done={done} />
      <RetrievalNote message={message} />

      {done && (
        <div className="mt-3 flex flex-wrap items-center gap-1 text-muted">
          <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs hover:bg-leaf-faint hover:text-ink" aria-label="Copy answer">
            {copied ? <Check className="h-3.5 w-3.5 text-leaf" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
          {message.id && (
            <>
              <button
                onClick={() => onRate(1)}
                aria-pressed={message.rating === 1}
                className={`rounded-md p-1.5 hover:bg-leaf-faint hover:text-ink ${message.rating === 1 ? "text-forest-700" : ""}`}
                aria-label="Helpful"
              >
                <ThumbsUp className={`h-3.5 w-3.5 ${message.rating === 1 ? "fill-current" : ""}`} />
              </button>
              <button
                onClick={() => onRate(-1)}
                aria-pressed={message.rating === -1}
                className={`rounded-md p-1.5 hover:bg-leaf-faint hover:text-ink ${message.rating === -1 ? "text-danger" : ""}`}
                aria-label="Not helpful"
              >
                <ThumbsDown className={`h-3.5 w-3.5 ${message.rating === -1 ? "fill-current" : ""}`} />
              </button>
            </>
          )}
          {isLast && canAct && (
            <span className="ml-auto flex gap-1">
              <button onClick={() => onFollowup("Can you explain that more simply, for a beginner?")} className="rounded-md border border-line px-2.5 py-1 text-xs hover:border-forest-600/40 hover:bg-leaf-faint hover:text-ink">
                Simpler
              </button>
              <button onClick={() => onFollowup("Can you go into more technical detail on that?")} className="rounded-md border border-line px-2.5 py-1 text-xs hover:border-forest-600/40 hover:bg-leaf-faint hover:text-ink">
                More technical
              </button>
            </span>
          )}
        </div>
      )}

      {done && isLast && canAct && message.followups && message.followups.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Follow-up questions</h3>
          <div className="flex flex-col items-start gap-1.5">
            {message.followups.map((q) => (
              <button key={q} onClick={() => onFollowup(q)} className="rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm text-ink transition hover:border-forest-600/40 hover:bg-leaf-faint">
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
