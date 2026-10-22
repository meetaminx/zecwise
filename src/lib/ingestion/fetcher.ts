import { HttpError, fetchWithTimeout, isRetryableStatus, withRetry } from "@/lib/http";
import { isAllowed, parseRobots, type RobotsRules } from "./robots";
import { assertPublicUrl } from "./url";

export type FetchOptions = {
  userAgent: string;
  timeoutMs: number;
  maxBytes: number;
  perHostDelayMs: number;
  etag?: string | null;
  lastModified?: string | null;
  accept?: string;
  respectRobots?: boolean;
};

export type FetchedPage =
  | { status: "ok"; url: string; finalUrl: string; contentType: string; body: string; etag: string | null; lastModified: string | null }
  | { status: "not_modified"; url: string }
  | { status: "blocked"; url: string; reason: string };

const robotsCache = new Map<string, { rules: RobotsRules; fetchedAt: number }>();
const lastHit = new Map<string, number>();
const ROBOTS_TTL_MS = 6 * 60 * 60 * 1000;

async function robotsFor(origin: string, opts: FetchOptions): Promise<RobotsRules> {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < ROBOTS_TTL_MS) return cached.rules;
  let rules: RobotsRules = { allow: [], disallow: [] };
  try {
    const res = await fetchWithTimeout(`${origin}/robots.txt`, { timeoutMs: opts.timeoutMs, headers: { "user-agent": opts.userAgent } });
    if (res.ok) rules = parseRobots(await res.text(), opts.userAgent);
    // 401/403 on robots.txt means the site restricts automated access entirely.
    else if (res.status === 401 || res.status === 403) rules = { allow: [], disallow: ["/"] };
  } catch {
    // Unreachable robots.txt is treated as "no restrictions", per RFC 9309 §2.3.1.4 for 4xx; network errors fall through as well.
  }
  robotsCache.set(origin, { rules, fetchedAt: Date.now() });
  return rules;
}

async function politeDelay(host: string, minDelayMs: number) {
  const last = lastHit.get(host) ?? 0;
  const wait = last + minDelayMs - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastHit.set(host, Date.now());
}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new HttpError(`Response too large (${declared} bytes)`, 413, false);
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(`Response exceeded ${maxBytes} bytes`, 413, false);
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

/**
 * Fetches a public URL politely: checks robots.txt, waits between requests to
 * the same host (honouring Crawl-delay), sends conditional headers, enforces a
 * timeout and size cap, and retries transient failures.
 */
export async function politeFetch(url: string, opts: FetchOptions): Promise<FetchedPage> {
  assertPublicUrl(url);
  const target = new URL(url);
  let delayMs = opts.perHostDelayMs;
  if (opts.respectRobots !== false) {
    const rules = await robotsFor(target.origin, opts);
    if (!isAllowed(rules, target.pathname + target.search)) {
      return { status: "blocked", url, reason: "Disallowed by robots.txt" };
    }
    if (rules.crawlDelaySeconds) delayMs = Math.max(delayMs, Math.min(rules.crawlDelaySeconds, 30) * 1000);
  }

  return withRetry(async () => {
    await politeDelay(target.host, delayMs);
    const headers: Record<string, string> = {
      "user-agent": opts.userAgent,
      accept: opts.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
    };
    if (opts.etag) headers["if-none-match"] = opts.etag;
    if (opts.lastModified) headers["if-modified-since"] = opts.lastModified;
    const res = await fetchWithTimeout(url, { timeoutMs: opts.timeoutMs, headers, redirect: "follow" });
    if (res.status === 304) return { status: "not_modified", url } as const;
    if (res.status === 401 || res.status === 403 || res.status === 451) {
      return { status: "blocked", url, reason: `Access restricted (HTTP ${res.status})` } as const;
    }
    if (!res.ok) throw new HttpError(`HTTP ${res.status} for ${url}`, res.status, isRetryableStatus(res.status));
    assertPublicUrl(res.url || url);
    const body = await readLimited(res, opts.maxBytes);
    return {
      status: "ok",
      url,
      finalUrl: res.url || url,
      contentType: res.headers.get("content-type") ?? "",
      body,
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
    } as const;
  });
}

export function resetFetcherState() {
  robotsCache.clear();
  lastHit.clear();
}
