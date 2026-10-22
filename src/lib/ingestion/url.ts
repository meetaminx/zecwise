const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|igshid|_hsenc|_hsmi)$/i;

/**
 * Canonical form used for de-duplication: lowercase scheme and host, no default
 * port, no fragment, no tracking parameters, sorted query, and no trailing slash
 * except for the root path.
 */
export function normalizeUrl(input: string, base?: string): string {
  const url = new URL(input.trim(), base);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme: ${url.protocol}`);
  }
  url.hash = "";
  url.username = "";
  url.password = "";
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  const params = [...url.searchParams.entries()].filter(([key]) => !TRACKING_PARAMS.test(key));
  params.sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [key, value] of params) url.searchParams.append(key, value);
  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/index\.html?$/i, "/");
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[?::1\]?$|172\.(1[6-9]|2\d|3[01])\.)/i;

/** Blocks obvious internal targets so an admin-entered URL cannot be used to probe the server's network. */
export function assertPublicUrl(value: string) {
  const url = new URL(value);
  if (PRIVATE_HOST.test(url.hostname) && process.env.ZECWISE_ALLOW_PRIVATE_HOSTS !== "1") {
    throw new Error(`Refusing to fetch private or local address: ${url.hostname}`);
  }
}

export function sameSite(a: string, b: string): boolean {
  return new URL(a).host === new URL(b).host;
}
