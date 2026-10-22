import "server-only";
import { config } from "@/lib/config";
import { query } from "@/lib/db";
import { HttpError, fetchWithTimeout, isRetryableStatus, withRetry } from "@/lib/http";
import { detectInjection } from "@/lib/ingestion/injection";
import { normalizeUrl } from "@/lib/ingestion/url";
import type { Candidate, Trust } from "@/lib/retrieval/types";
import { recordUsage } from "@/lib/usage";
import { trustForUrl } from "./trust";

export type WebSearchOptions = { recencyDays?: number; maxResults?: number };

type RawResult = { title: string; url: string; content: string; publishedAt: string | null; score: number };

export function webSearchEnabled(): boolean {
  return (config.search.provider === "tavily" && !!config.search.tavilyKey) || (config.search.provider === "brave" && !!config.search.braveKey);
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function tavily(q: string, opts: WebSearchOptions): Promise<RawResult[]> {
  const body: Record<string, unknown> = {
    query: q,
    max_results: opts.maxResults ?? config.search.maxResults,
    search_depth: "advanced",
    include_answer: false,
    include_raw_content: false,
    topic: opts.recencyDays ? "news" : "general",
  };
  if (opts.recencyDays) body.days = opts.recencyDays;
  const json = await withRetry(async () => {
    const res = await fetchWithTimeout("https://api.tavily.com/search", {
      method: "POST",
      timeoutMs: config.search.timeoutMs,
      headers: { "content-type": "application/json", authorization: `Bearer ${config.search.tavilyKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new HttpError(`Tavily search failed: HTTP ${res.status}`, res.status, isRetryableStatus(res.status));
    return (await res.json()) as { results?: Array<{ title: string; url: string; content: string; score?: number; published_date?: string }> };
  });
  return (json.results ?? []).map((r) => ({ title: r.title, url: r.url, content: r.content, publishedAt: isoOrNull(r.published_date), score: r.score ?? 0.5 }));
}

async function brave(q: string, opts: WebSearchOptions): Promise<RawResult[]> {
  const params = new URLSearchParams({ q, count: String(opts.maxResults ?? config.search.maxResults), extra_snippets: "true" });
  if (opts.recencyDays) params.set("freshness", opts.recencyDays <= 7 ? "pw" : opts.recencyDays <= 31 ? "pm" : "py");
  const json = await withRetry(async () => {
    const res = await fetchWithTimeout(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      timeoutMs: config.search.timeoutMs,
      headers: { accept: "application/json", "x-subscription-token": config.search.braveKey! },
    });
    if (!res.ok) throw new HttpError(`Brave search failed: HTTP ${res.status}`, res.status, isRetryableStatus(res.status));
    return (await res.json()) as { web?: { results?: Array<{ title: string; url: string; description?: string; extra_snippets?: string[]; page_age?: string }> } };
  });
  const results = json.web?.results ?? [];
  return results.map((r, i) => ({
    title: r.title,
    url: r.url,
    content: [r.description, ...(r.extra_snippets ?? [])].filter(Boolean).join("\n").replace(/<\/?strong>/g, ""),
    publishedAt: isoOrNull(r.page_age),
    score: 1 - i / Math.max(results.length, 1),
  }));
}

async function registeredHostTrust(): Promise<Map<string, Trust>> {
  try {
    const rows = await query<{ url: string; trust: Trust }>("select url, trust from sources where enabled");
    const map = new Map<string, Trust>();
    for (const row of rows) {
      try {
        map.set(new URL(row.url.startsWith("http") ? row.url : `https://github.com/${row.url}`).hostname.toLowerCase(), row.trust);
      } catch {
        /* skip */
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Live web search through an authorized search API (Tavily or Brave). */
export async function searchWeb(q: string, opts: WebSearchOptions = {}): Promise<Candidate[]> {
  if (!webSearchEnabled()) return [];
  const provider = config.search.provider;
  const raw = provider === "tavily" ? await tavily(q, opts) : await brave(q, opts);
  void recordUsage({ kind: "search", provider, units: 1, purpose: "chat" });
  const registered = await registeredHostTrust();
  const retrievedAt = new Date().toISOString();
  const out: Candidate[] = [];
  for (const r of raw) {
    if (!r.url || !r.content?.trim()) continue;
    let url: string;
    try {
      url = normalizeUrl(r.url);
    } catch {
      continue;
    }
    let publisher: string | null = null;
    try {
      publisher = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      /* noop */
    }
    out.push({
      kind: "web",
      url,
      title: r.title?.trim() || url,
      publisher,
      publishedAt: r.publishedAt,
      retrievedAt,
      trust: trustForUrl(url, registered),
      snippet: r.content.trim().slice(0, 2400),
      documentId: null,
      chunkId: null,
      score: Math.max(0.05, Math.min(1, r.score)),
      flags: detectInjection(r.content),
    });
  }
  return out;
}
