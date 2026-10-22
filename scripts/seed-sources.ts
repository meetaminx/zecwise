import "dotenv/config";
import { Pool } from "pg";
import { normalizeUrl } from "../src/lib/ingestion/url";

/**
 * Registers a starter set of public Zcash sources and queues their first
 * ingestion. Registering a source does not mean it is indexed: each one shows as
 * indexed in the dashboard only after its ingestion job succeeds. Review the
 * list, the sites' terms and robots.txt rules before running it in production.
 */
const SOURCES = [
  { name: "Zcash Documentation (Read the Docs)", kind: "website", url: "https://zcash.readthedocs.io/en/latest/", category: "documentation", trust: "official", max_pages: 80, crawl_depth: 2, refresh: 10080 },
  { name: "Zcash Improvement Proposals (ZIPs)", kind: "website", url: "https://zips.z.cash/", category: "specification", trust: "official", max_pages: 150, crawl_depth: 1, refresh: 10080 },
  { name: "z.cash — Learn", kind: "website", url: "https://z.cash/learn/", category: "documentation", trust: "official", max_pages: 60, crawl_depth: 2, refresh: 10080 },
  { name: "zcashd releases", kind: "github_releases", url: "zcash/zcash", category: "github", trust: "primary", max_pages: 20, crawl_depth: 0, refresh: 1440 },
  { name: "Zebra releases", kind: "github_releases", url: "ZcashFoundation/zebra", category: "github", trust: "primary", max_pages: 20, crawl_depth: 0, refresh: 1440 },
  { name: "Zcash Community Forum — latest", kind: "rss", url: "https://forum.zcashcommunity.com/latest.rss", category: "community", trust: "community", max_pages: 30, crawl_depth: 0, refresh: 360 },
] as const;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  for (const s of SOURCES) {
    const url = s.kind === "github_releases" ? `https://github.com/${s.url}` : normalizeUrl(s.url);
    const normalized = s.kind === "github_releases" ? `${normalizeUrl(url)}#releases` : s.kind === "rss" ? `${url}#feed` : url;
    const row = await pool.query<{ id: string }>(
      `insert into sources (name, kind, url, normalized_url, category, trust, max_pages, crawl_depth, refresh_interval_minutes)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (normalized_url) do nothing returning id`,
      [s.name, s.kind, url, normalized, s.category, s.trust, s.max_pages, s.crawl_depth, s.refresh],
    );
    if (row.rows[0]) {
      await pool.query("insert into ingestion_jobs (kind, source_id) values ('source_refresh', $1) on conflict do nothing", [row.rows[0].id]);
      console.log(`registered ${s.name} (ingestion queued)`);
    } else console.log(`already registered: ${s.name}`);
  }
  await pool.end();
  console.log("Run `npm run worker -- --once` (or wait for the worker/cron) to ingest them.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
