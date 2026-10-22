import type { Trust } from "@/lib/retrieval/types";

/**
 * Default authority for well-known hosts in live search results. Hosts
 * registered as sources in the admin dashboard override this list.
 */
const HOST_TRUST: Array<[RegExp, Trust]> = [
  [/(^|\.)z\.cash$/, "official"],
  [/(^|\.)zips\.z\.cash$/, "official"],
  [/(^|\.)electriccoin\.co$/, "official"],
  [/(^|\.)zfnd\.org$/, "official"],
  [/(^|\.)zcash\.readthedocs\.io$/, "official"],
  [/(^|\.)zechub\.wiki$/, "reputable"],
  [/(^|\.)forum\.zcashcommunity\.com$/, "community"],
  [/(^|\.)zcashcommunity\.com$/, "community"],
  [/(^|\.)eprint\.iacr\.org$/, "primary"],
  [/(^|\.)arxiv\.org$/, "primary"],
  [/(^|\.)bitcoin\.org$/, "primary"],
  [/(^|\.)getmonero\.org$/, "primary"],
  [/(^|\.)ethereum\.org$/, "primary"],
  [/(^|\.)coindesk\.com$/, "reputable"],
  [/(^|\.)theblock\.co$/, "reputable"],
  [/(^|\.)decrypt\.co$/, "reputable"],
  [/(^|\.)reddit\.com$/, "community"],
  [/(^|\.)x\.com$|(^|\.)twitter\.com$/, "community"],
];

export function trustForUrl(url: string, registered: Map<string, Trust> = new Map()): Trust {
  let host: string;
  let path = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    path = u.pathname;
  } catch {
    return "unverified";
  }
  const reg = registered.get(host);
  if (reg) return reg;
  if (host === "github.com") return /^\/(zcash|zcashfoundation|Electric-Coin-Company|zingolabs|hhanh00|ZcashFoundation)\b/i.test(path) ? "primary" : "community";
  for (const [pattern, trust] of HOST_TRUST) if (pattern.test(host)) return trust;
  return "unverified";
}
