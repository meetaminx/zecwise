import "server-only";

/**
 * Server-side configuration. Every provider key is read here and only here, so
 * nothing secret can leak into a client bundle (this module imports
 * "server-only", which fails the build if a client component pulls it in).
 */

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function int(name: string, fallback: number): number {
  const raw = optional(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  databaseUrl: optional("DATABASE_URL"),
  sessionSecret: optional("SESSION_SECRET"),
  cronSecret: optional("CRON_SECRET"),

  llm: {
    apiKey: optional("ANTHROPIC_API_KEY"),
    model: optional("ZECWISE_MODEL") ?? "claude-opus-5-5",
    routerModel: optional("ZECWISE_ROUTER_MODEL") ?? optional("ZECWISE_MODEL") ?? "claude-opus-5-5",
    answerEffort: (optional("ZECWISE_ANSWER_EFFORT") ?? "medium") as "low" | "medium" | "high",
    timeoutMs: int("ZECWISE_LLM_TIMEOUT_MS", 120_000),
  },

  search: {
    provider: (optional("SEARCH_PROVIDER") ?? (optional("TAVILY_API_KEY") ? "tavily" : optional("BRAVE_SEARCH_API_KEY") ? "brave" : "none")) as
      | "tavily"
      | "brave"
      | "none",
    tavilyKey: optional("TAVILY_API_KEY"),
    braveKey: optional("BRAVE_SEARCH_API_KEY"),
    timeoutMs: int("SEARCH_TIMEOUT_MS", 12_000),
    maxResults: int("SEARCH_MAX_RESULTS", 6),
  },

  embeddings: {
    voyageKey: optional("VOYAGE_API_KEY"),
    model: optional("VOYAGE_MODEL") ?? "voyage-3.5",
    dimensions: 1024,
  },

  ingestion: {
    userAgent: optional("INGEST_USER_AGENT") ?? "ZecWiseBot/0.1 (+https://github.com/napoleecrypt-commits/zecwise)",
    timeoutMs: int("INGEST_TIMEOUT_MS", 20_000),
    maxBytes: int("INGEST_MAX_BYTES", 5_000_000),
    perHostDelayMs: int("INGEST_PER_HOST_DELAY_MS", 1_500),
    githubToken: optional("GITHUB_TOKEN"),
  },

  rateLimit: {
    chatPerMinute: int("CHAT_RATE_LIMIT_PER_MINUTE", 12),
  },
};

export type FeatureStatus = {
  llm: boolean;
  database: boolean;
  liveSearch: boolean;
  liveSearchProvider: string;
  semanticSearch: boolean;
  auth: boolean;
};

export function featureStatus(): FeatureStatus {
  const searchKey =
    config.search.provider === "tavily" ? config.search.tavilyKey : config.search.provider === "brave" ? config.search.braveKey : undefined;
  return {
    llm: Boolean(config.llm.apiKey),
    database: Boolean(config.databaseUrl),
    liveSearch: Boolean(searchKey),
    liveSearchProvider: searchKey ? config.search.provider : "none",
    semanticSearch: Boolean(config.embeddings.voyageKey),
    auth: Boolean(config.sessionSecret && config.databaseUrl),
  };
}
