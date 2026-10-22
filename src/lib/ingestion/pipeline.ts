import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { config } from "@/lib/config";
import { query, queryOne, transaction } from "@/lib/db";
import { HttpError, fetchWithTimeout, isRetryableStatus, withRetry } from "@/lib/http";
import { errorMessage, log } from "@/lib/log";
import { embed, toPgVector } from "@/lib/retrieval/embeddings";
import { recordUsage } from "@/lib/usage";
import { chunkSections } from "./chunk";
import { extractHtml, extractPlainText, type ExtractedDocument } from "./extract";
import { parseFeed, parseGithubRepo } from "./feeds";
import { politeFetch, type FetchOptions } from "./fetcher";
import { detectInjection } from "./injection";
import { normalizeUrl, sameSite } from "./url";

export type SourceRow = {
  id: string;
  name: string;
  kind: "url" | "website" | "rss" | "github_releases";
  url: string;
  category: string;
  trust: string;
  enabled: boolean;
  refresh_interval_minutes: number;
  max_pages: number;
  crawl_depth: number;
  path_prefix: string | null;
};

export type DocOutcome = "indexed" | "unchanged" | "not_modified" | "duplicate" | "blocked" | "failed" | "skipped_noindex" | "empty";

export type RunStats = Record<DocOutcome, number> & { pages: number };

const emptyStats = (): RunStats => ({ indexed: 0, unchanged: 0, not_modified: 0, duplicate: 0, blocked: 0, failed: 0, skipped_noindex: 0, empty: 0, pages: 0 });

type Logger = (level: "info" | "warn" | "error", message: string, url?: string) => Promise<void>;

export function contentHash(text: string): string {
  return createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex");
}

function fetchOptions(extra: Partial<FetchOptions> = {}): FetchOptions {
  return {
    userAgent: config.ingestion.userAgent,
    timeoutMs: config.ingestion.timeoutMs,
    maxBytes: config.ingestion.maxBytes,
    perHostDelayMs: config.ingestion.perHostDelayMs,
    ...extra,
  };
}

type DocMeta = { sourceId: string | null; category: string; trust: string };

/**
 * Stores an extracted document: detects unchanged and duplicate content by hash,
 * re-chunks and re-embeds only when content changed, and marks the document
 * `indexed` only after chunks are committed.
 */
async function storeExtracted(doc: ExtractedDocument, meta: DocMeta, http: { etag?: string | null; lastModified?: string | null }, logEvent: Logger): Promise<DocOutcome> {
  const text = doc.text.trim();
  const canonicalUrl = doc.canonicalUrl;
  if (text.length < 80) {
    await upsertFailure(canonicalUrl, meta, "Extracted text was empty or too short to index.");
    await logEvent("warn", "No indexable text extracted", canonicalUrl);
    return "empty";
  }
  const hash = contentHash(text);
  const existing = await queryOne<{ id: string; content_hash: string | null; status: string }>(
    "select id, content_hash, status from documents where canonical_url = $1",
    [canonicalUrl],
  );

  if (existing && existing.content_hash === hash && existing.status === "indexed") {
    await query(
      `update documents set retrieved_at = now(), last_success_at = now(), http_etag = $2, http_last_modified = $3, error = null,
         source_id = coalesce(source_id, $4), updated_at = now() where id = $1`,
      [existing.id, http.etag ?? null, http.lastModified ?? null, meta.sourceId],
    );
    return "unchanged";
  }

  const dup = await queryOne<{ id: string; canonical_url: string }>(
    "select id, canonical_url from documents where content_hash = $1 and status = 'indexed' and canonical_url <> $2 limit 1",
    [hash, canonicalUrl],
  );
  if (dup) {
    await query(
      `insert into documents (source_id, canonical_url, title, publisher, author, published_at, retrieved_at, category, trust, content_hash, status, duplicate_of, error)
       values ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9, 'duplicate', $10, null)
       on conflict (canonical_url) do update set status = 'duplicate', duplicate_of = excluded.duplicate_of, content_hash = excluded.content_hash,
         retrieved_at = now(), updated_at = now()`,
      [meta.sourceId, canonicalUrl, doc.title, doc.publisher, doc.author, doc.publishedAt, meta.category, meta.trust, hash, dup.id],
    );
    if (existing) await query("delete from chunks where document_id = $1", [existing.id]);
    await logEvent("info", `Duplicate of ${dup.canonical_url}`, canonicalUrl);
    return "duplicate";
  }

  const chunks = chunkSections(doc.sections);
  let vectors: number[][] | null = null;
  try {
    const result = await embed(
      chunks.map((c) => (c.heading ? `${doc.title} — ${c.heading}\n${c.content}` : `${doc.title}\n${c.content}`)),
      "document",
    );
    if (result) {
      vectors = result.vectors;
      await recordUsage({ kind: "embedding", provider: "voyage", model: config.embeddings.model, inputTokens: result.tokens, purpose: "ingestion" });
    }
  } catch (err) {
    // Keyword search still works without vectors; record the problem and continue.
    await logEvent("warn", `Embedding failed, indexed for keyword search only: ${errorMessage(err)}`, canonicalUrl);
  }

  const flags = detectInjection(text);
  if (flags.length) await logEvent("warn", `Instruction-like content flagged: ${flags.join(", ")}`, canonicalUrl);

  await transaction(async (client: PoolClient) => {
    const row = await client.query<{ id: string }>(
      `insert into documents (source_id, canonical_url, title, publisher, author, published_at, retrieved_at, category, trust, content_text,
          content_hash, status, duplicate_of, version, last_success_at, last_changed_at, http_etag, http_last_modified, error, injection_flags)
       values ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9, $10, 'indexed', null, 1, now(), now(), $11, $12, null, $13)
       on conflict (canonical_url) do update set
         source_id = coalesce(documents.source_id, excluded.source_id), title = excluded.title, publisher = excluded.publisher,
         author = excluded.author, published_at = coalesce(excluded.published_at, documents.published_at), retrieved_at = now(),
         category = excluded.category, trust = excluded.trust, content_text = excluded.content_text, content_hash = excluded.content_hash,
         status = 'indexed', duplicate_of = null, version = documents.version + 1, last_success_at = now(), last_changed_at = now(),
         http_etag = excluded.http_etag, http_last_modified = excluded.http_last_modified, error = null,
         injection_flags = excluded.injection_flags, updated_at = now()
       returning id`,
      [meta.sourceId, canonicalUrl, doc.title, doc.publisher, doc.author, doc.publishedAt, meta.category, meta.trust, text, hash, http.etag ?? null, http.lastModified ?? null, flags],
    );
    const documentId = row.rows[0].id;
    await client.query("delete from chunks where document_id = $1", [documentId]);
    for (const [i, chunk] of chunks.entries()) {
      await client.query(
        "insert into chunks (document_id, ord, heading, content, token_estimate, embedding) values ($1, $2, $3, $4, $5, $6)",
        [documentId, chunk.ord, chunk.heading, chunk.content, chunk.tokenEstimate, vectors?.[i] ? toPgVector(vectors[i]) : null],
      );
    }
  });
  await logEvent("info", `Indexed ${chunks.length} passages${vectors ? " with embeddings" : " (keyword only)"}`, canonicalUrl);
  return "indexed";
}

async function upsertFailure(url: string, meta: DocMeta, error: string, status: "failed" | "blocked" = "failed") {
  await query(
    `insert into documents (source_id, canonical_url, category, trust, status, error, retrieved_at)
     values ($1, $2, $3, $4, $5, $6, now())
     on conflict (canonical_url) do update set error = excluded.error, retrieved_at = now(), updated_at = now(),
       status = case when documents.status = 'indexed' and excluded.status = 'failed' then documents.status else excluded.status end`,
    [meta.sourceId, url, meta.category, meta.trust, status, error],
  );
}

/** Fetches one URL and indexes it. Previously indexed content stays searchable if a refresh fails. */
export async function ingestUrl(url: string, meta: DocMeta, logEvent: Logger): Promise<{ outcome: DocOutcome; links: string[]; finalUrl: string }> {
  const normalized = normalizeUrl(url);
  const prior = await queryOne<{ http_etag: string | null; http_last_modified: string | null; status: string }>(
    "select http_etag, http_last_modified, status from documents where canonical_url = $1",
    [normalized],
  );
  try {
    const page = await politeFetch(normalized, fetchOptions(prior?.status === "indexed" ? { etag: prior.http_etag, lastModified: prior.http_last_modified } : {}));
    if (page.status === "blocked") {
      await upsertFailure(normalized, meta, page.reason, "blocked");
      await logEvent("warn", page.reason, normalized);
      return { outcome: "blocked", links: [], finalUrl: normalized };
    }
    if (page.status === "not_modified") {
      await query("update documents set retrieved_at = now(), last_success_at = now(), error = null where canonical_url = $1", [normalized]);
      return { outcome: "not_modified", links: [], finalUrl: normalized };
    }
    const type = page.contentType.toLowerCase();
    let doc: ExtractedDocument;
    if (type.includes("html") || /^\s*<(!doctype|html)/i.test(page.body)) doc = extractHtml(page.body, page.finalUrl);
    else if (type.startsWith("text/") || type.includes("markdown")) doc = extractPlainText(page.body, page.finalUrl);
    else {
      const reason = `Unsupported content type: ${page.contentType || "unknown"}`;
      await upsertFailure(normalized, meta, reason);
      await logEvent("warn", reason, normalized);
      return { outcome: "failed", links: [], finalUrl: normalized };
    }
    if (doc.noindex) {
      await upsertFailure(normalized, meta, "Page requests noindex; respected.", "blocked");
      return { outcome: "skipped_noindex", links: doc.links, finalUrl: page.finalUrl };
    }
    const outcome = await storeExtracted(doc, meta, { etag: page.etag, lastModified: page.lastModified }, logEvent);
    return { outcome, links: doc.links, finalUrl: page.finalUrl };
  } catch (err) {
    const message = errorMessage(err);
    await upsertFailure(normalized, meta, message);
    await logEvent("error", message, normalized);
    return { outcome: "failed", links: [], finalUrl: normalized };
  }
}

async function crawlWebsite(source: SourceRow, meta: DocMeta, stats: RunStats, logEvent: Logger) {
  const start = normalizeUrl(source.url);
  // Stay under the start URL's path (or the configured prefix): /docs covers /docs and /docs/*.
  const prefix = (source.path_prefix || new URL(start).pathname).replace(/\/+$/, "");
  const inScope = (path: string) => !prefix || path === prefix || path.startsWith(`${prefix}/`);
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: start, depth: 0 }];
  while (queue.length && stats.pages < source.max_pages) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    stats.pages++;
    const result = await ingestUrl(url, meta, logEvent);
    stats[result.outcome]++;
    if (result.finalUrl !== url) visited.add(normalizeUrl(result.finalUrl));
    if (depth >= source.crawl_depth) continue;
    for (const link of result.links) {
      if (visited.has(link) || !sameSite(link, start)) continue;
      const path = new URL(link).pathname;
      if (!inScope(path)) continue;
      if (/\.(png|jpe?g|gif|svg|webp|pdf|zip|gz|tar|mp4|mp3|woff2?|css|js|json|xml)$/i.test(path)) continue;
      if (queue.length + visited.size < source.max_pages * 4) queue.push({ url: link, depth: depth + 1 });
    }
  }
}

async function ingestFeed(source: SourceRow, meta: DocMeta, stats: RunStats, logEvent: Logger) {
  const page = await politeFetch(normalizeUrl(source.url), fetchOptions({ accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9" }));
  if (page.status === "blocked") throw new Error(`Feed blocked: ${page.reason}`);
  if (page.status === "not_modified") return;
  const feed = parseFeed(page.body);
  for (const item of feed.items.slice(0, source.max_pages)) {
    stats.pages++;
    let url: string;
    try {
      url = normalizeUrl(item.url, source.url);
    } catch {
      stats.failed++;
      continue;
    }
    const result = await ingestUrl(url, meta, logEvent);
    if ((result.outcome === "failed" || result.outcome === "blocked" || result.outcome === "empty") && item.summary.length > 200) {
      // The feed itself is a permitted channel; index the item text it publishes, attributed to the item's URL.
      const outcome = await storeExtracted(
        {
          title: item.title || url,
          canonicalUrl: url,
          publisher: feed.title || null,
          author: item.author,
          publishedAt: item.publishedAt,
          sections: [{ heading: null, text: item.summary }],
          text: item.summary,
          links: [],
          noindex: false,
        },
        meta,
        {},
        logEvent,
      );
      stats[outcome]++;
      continue;
    }
    if (item.publishedAt) await query("update documents set published_at = coalesce(published_at, $2) where canonical_url = $1", [url, item.publishedAt]);
    stats[result.outcome]++;
  }
}

async function ingestGithubReleases(source: SourceRow, meta: DocMeta, stats: RunStats, logEvent: Logger) {
  const { owner, repo } = parseGithubRepo(source.url);
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": config.ingestion.userAgent, "x-github-api-version": "2022-11-28" };
  if (config.ingestion.githubToken) headers.authorization = `Bearer ${config.ingestion.githubToken}`;
  const releases = await withRetry(async () => {
    const res = await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=${Math.min(source.max_pages, 100)}`, {
      timeoutMs: config.ingestion.timeoutMs,
      headers,
    });
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
      throw new HttpError("GitHub API rate limit reached; set GITHUB_TOKEN for a higher limit.", 429, false);
    }
    if (!res.ok) throw new HttpError(`GitHub API HTTP ${res.status}`, res.status, isRetryableStatus(res.status));
    return (await res.json()) as Array<{ html_url: string; name: string | null; tag_name: string; body: string | null; published_at: string | null; draft: boolean; prerelease: boolean; author?: { login: string } }>;
  });
  for (const release of releases.filter((r) => !r.draft)) {
    stats.pages++;
    const body = (release.body ?? "").trim();
    const title = `${owner}/${repo} ${release.name || release.tag_name}${release.prerelease ? " (pre-release)" : ""}`;
    const text = `Release ${release.tag_name} of ${owner}/${repo}${release.published_at ? `, published ${release.published_at.slice(0, 10)}` : ""}.\n\n${body}`;
    const outcome = await storeExtracted(
      {
        title,
        canonicalUrl: normalizeUrl(release.html_url),
        publisher: `GitHub · ${owner}/${repo}`,
        author: release.author?.login ?? null,
        publishedAt: release.published_at,
        sections: body.split(/\n(?=#+ )/).map((part) => {
          const m = part.match(/^#+\s+(.+)\n?/);
          return { heading: m ? m[1].trim() : null, text: m ? part.slice(m[0].length) : part };
        }).map((s, i) => (i === 0 ? { ...s, text: `${text.split("\n\n")[0]}\n${s.text}` } : s)),
        text,
        links: [],
        noindex: false,
      },
      meta,
      {},
      logEvent,
    );
    stats[outcome]++;
  }
}

/** Runs one source refresh end to end and records the outcome on the source row. */
export async function refreshSource(sourceId: string, jobId: string | null): Promise<RunStats> {
  const source = await queryOne<SourceRow>("select * from sources where id = $1", [sourceId]);
  if (!source) throw new Error("Source not found");
  const stats = emptyStats();
  const logEvent: Logger = async (level, message, url) => {
    await query("insert into ingestion_events (job_id, source_id, level, url, message) values ($1, $2, $3, $4, $5)", [jobId, sourceId, level, url ?? null, message.slice(0, 2000)]);
  };
  if (!source.enabled) {
    await logEvent("info", "Source is disabled; skipped.");
    return stats;
  }
  const meta: DocMeta = { sourceId: source.id, category: source.category, trust: source.trust };
  await query("update sources set last_run_at = now() where id = $1", [sourceId]);
  try {
    if (source.kind === "url") {
      stats.pages++;
      stats[(await ingestUrl(source.url, meta, logEvent)).outcome]++;
    } else if (source.kind === "website") await crawlWebsite(source, meta, stats, logEvent);
    else if (source.kind === "rss") await ingestFeed(source, meta, stats, logEvent);
    else if (source.kind === "github_releases") await ingestGithubReleases(source, meta, stats, logEvent);

    const succeeded = stats.indexed + stats.unchanged + stats.not_modified + stats.duplicate > 0;
    let summary = Object.entries(stats).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(", ");
    if (!succeeded && jobId) {
      const firstError = await queryOne<{ message: string }>(
        "select message from ingestion_events where job_id = $1 and level in ('error', 'warn') order by created_at limit 1",
        [jobId],
      );
      if (firstError) summary += `; first problem: ${firstError.message.slice(0, 300)}`;
    }
    await query(
      `update sources set last_success_at = case when $2 then now() else last_success_at end,
         last_error = case when $2 then null else $3 end,
         next_run_at = now() + make_interval(mins => refresh_interval_minutes) where id = $1`,
      [sourceId, succeeded, succeeded ? null : `No documents were indexed (${summary || "nothing fetched"}).`],
    );
    if (!succeeded) throw new Error(`No documents were indexed (${summary || "nothing fetched"}).`);
    return stats;
  } catch (err) {
    const message = errorMessage(err);
    await query("update sources set last_error = $2, next_run_at = now() + make_interval(mins => least(refresh_interval_minutes, 60)) where id = $1", [sourceId, message]);
    if (!message.startsWith("No documents")) await logEvent("error", message);
    throw Object.assign(new Error(message), { stats });
  }
}

export async function reindexDocument(documentId: string, jobId: string | null): Promise<RunStats> {
  const doc = await queryOne<{ canonical_url: string; source_id: string | null; category: string; trust: string }>(
    "select canonical_url, source_id, category, trust from documents where id = $1",
    [documentId],
  );
  if (!doc) throw new Error("Document not found");
  const logEvent: Logger = async (level, message, url) => {
    await query("insert into ingestion_events (job_id, source_id, level, url, message) values ($1, $2, $3, $4, $5)", [jobId, doc.source_id, level, url ?? null, message.slice(0, 2000)]);
  };
  // Force a full fetch by clearing the validators, then re-extract.
  await query("update documents set http_etag = null, http_last_modified = null, content_hash = null where id = $1", [documentId]);
  const stats = emptyStats();
  stats.pages = 1;
  const { outcome } = await ingestUrl(doc.canonical_url, { sourceId: doc.source_id, category: doc.category, trust: doc.trust }, logEvent);
  stats[outcome]++;
  if (outcome === "failed" || outcome === "blocked" || outcome === "empty") throw Object.assign(new Error(`Re-index ${outcome}`), { stats });
  return stats;
}

export { log };
