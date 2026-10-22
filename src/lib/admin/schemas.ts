import { z } from "zod";

export const TRUST_LEVELS = ["official", "primary", "reputable", "community", "unverified"] as const;
export const SOURCE_KINDS = ["url", "website", "rss", "github_releases"] as const;
export const SOURCE_CATEGORIES = [
  "documentation",
  "specification",
  "github",
  "research",
  "wallet",
  "news",
  "blog",
  "community",
] as const;

export const SourceInput = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(SOURCE_KINDS),
  url: z.string().trim().min(3).max(2000),
  category: z.enum(SOURCE_CATEGORIES).default("documentation"),
  trust: z.enum(TRUST_LEVELS).default("unverified"),
  refresh_interval_minutes: z.coerce.number().int().min(15).max(60 * 24 * 90).default(1440),
  max_pages: z.coerce.number().int().min(1).max(500).default(25),
  crawl_depth: z.coerce.number().int().min(0).max(3).default(1),
  path_prefix: z.string().trim().max(500).nullish(),
  enabled: z.boolean().default(true),
});

export const SourcePatch = SourceInput.partial().omit({ kind: true, url: true });
