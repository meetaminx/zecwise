/**
 * Fixed-window rate limiter kept in process memory. This protects a single
 * server instance; on multi-instance deployments put a shared limiter (for
 * example Upstash or a Postgres counter) in front of /api/chat as well.
 */
const windows = new Map<string, { start: number; count: number }>();

export function rateLimit(key: string, limit: number, windowMs = 60_000): { ok: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const current = windows.get(key);
  if (!current || now - current.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    }
    return { ok: true, retryAfterSeconds: 0 };
  }
  current.count += 1;
  if (current.count > limit) {
    return { ok: false, retryAfterSeconds: Math.ceil((current.start + windowMs - now) / 1000) };
  }
  return { ok: true, retryAfterSeconds: 0 };
}

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
