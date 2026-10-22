// Client-side shapes mirroring the NDJSON events from /api/chat. Kept separate
// from server modules so nothing server-only is pulled into the browser bundle.

export type Trust = "official" | "primary" | "reputable" | "community" | "unverified";

export type Source = {
  ref: number;
  kind: "kb" | "web";
  url: string;
  title: string;
  publisher: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  trust: Trust;
  snippet: string;
  cited?: boolean;
};

export type RetrievalStatus = {
  knowledgeBase: { searched: boolean; results: number; note?: string };
  liveSearch: { used: boolean; provider: string; results: number; note?: string };
  date: string;
};

export type CitationInfo = {
  cited: number[];
  invalid: number[];
  weak: Array<{ ref: number; sentence: string; support: number }>;
  unverifiedUrls: string[];
};

export type Phase = "planning" | "retrieving" | "writing" | "done" | "error";

export type ChatMessage = {
  localId: string;
  id: string | null;
  role: "user" | "assistant";
  content: string;
  phase?: Phase;
  sources?: Source[];
  followups?: string[];
  status?: RetrievalStatus;
  categories?: string[];
  citations?: CitationInfo;
  error?: string | null;
  errorCode?: string;
  rating?: number | null;
  redacted?: string[];
};

export type ConversationSummary = { id: string; title: string; updated_at: string };

export type FeatureStatus = {
  llm: boolean;
  database: boolean;
  liveSearch: boolean;
  liveSearchProvider: string;
  semanticSearch: boolean;
  auth: boolean;
};
