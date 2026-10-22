import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPool, query, queryOne } from "@/lib/db";
import { enqueueSourceRefresh, processJobs } from "@/lib/ingestion/jobs";
import { resetFetcherState } from "@/lib/ingestion/fetcher";
import { searchKnowledgeBase } from "@/lib/retrieval/kb";
import { retrievalForTesting } from "@/lib/ai/orchestrator";
import { heuristicPlan } from "@/lib/ai/router";
import { validateCitations } from "@/lib/citations/validate";
import { html, startSite } from "./site";

const LONG = (topic: string) =>
  Array.from({ length: 6 }, (_, i) => `<p>${topic} paragraph ${i}: this passage explains ${topic} in enough detail to be indexed as real content for retrieval tests.</p>`).join("");

let site: Awaited<ReturnType<typeof startSite>>;

async function addSource(kind: string, url: string, extra: Record<string, unknown> = {}) {
  const row = await queryOne<{ id: string }>(
    `insert into sources (name, kind, url, normalized_url, category, trust, max_pages, crawl_depth)
     values ($1, $2, $3, $4, 'documentation', $5, $6, $7) returning id`,
    [extra.name ?? url, kind, url, `${url}#${kind}`, extra.trust ?? "official", extra.max_pages ?? 20, extra.crawl_depth ?? 2],
  );
  return row!.id;
}

async function runSource(id: string) {
  await enqueueSourceRefresh(id);
  await processJobs({ workerId: "test", maxJobs: 5 });
  return queryOne<{ status: string; error: string | null; stats: Record<string, number> }>(
    "select status, error, stats from ingestion_jobs where source_id = $1 order by created_at desc limit 1",
    [id],
  );
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("Integration tests need DATABASE_URL (see .env.test)");
  await query("truncate sources, documents, chunks, ingestion_jobs, ingestion_events, usage_events, retrieval_events cascade");
  site = await startSite();
  site.pages.set("/robots.txt", { type: "text/plain", body: "User-agent: *\nDisallow: /private\n" });
  site.pages.set("/docs", {
    type: "text/html",
    body: html("Zcash docs home", `<h1>Docs</h1>${LONG("Zcash overview")}<a href="/docs/shielded">Shielded</a><a href="/docs/loop-a">Loop</a><a href="/private/secret">Private</a><a href="/elsewhere">Outside prefix</a>`),
  });
  site.pages.set("/docs/shielded", {
    type: "text/html",
    body: html("Shielded transactions", `<h1>Shielded transactions</h1><p>Shielded transactions use zk-SNARK proofs so that the sender, receiver and amount are encrypted on the Zcash blockchain.</p>${LONG("shielded pool")}<a href="/docs">Home</a>`),
  });
  // Two pages that link to each other: the crawler must not loop.
  site.pages.set("/docs/loop-a", { type: "text/html", body: html("Loop A", `${LONG("viewing keys")}<a href="/docs/loop-b">B</a>`) });
  site.pages.set("/docs/loop-b", { type: "text/html", body: html("Loop B", `${LONG("viewing keys")}<a href="/docs/loop-a">A</a>`) });
  site.pages.set("/private/secret", { type: "text/html", body: html("Secret", LONG("secret")) });
  site.pages.set("/elsewhere", { type: "text/html", body: html("Elsewhere", LONG("elsewhere")) });
  site.pages.set("/feed.xml", {
    type: "application/rss+xml",
    body: `<?xml version="1.0"?><rss version="2.0"><channel><title>Zcash News</title>
      <item><title>Network upgrade announced</title><link>${"__BASE__"}/news/upgrade</link><pubDate>Tue, 01 Oct 2024 10:00:00 GMT</pubDate><description>Short</description></item>
      </channel></rss>`,
  });
  site.pages.set("/news/upgrade", { type: "text/html", body: html("Network upgrade announced", LONG("network upgrade activation height")) });
});

afterAll(async () => {
  await site?.close();
  await getPool().end();
});

describe("ingestion pipeline", () => {
  let docsSource: string;

  it("crawls a website within its prefix, respects robots.txt and does not loop", async () => {
    docsSource = await addSource("website", `${site.base}/docs`, { name: "Test docs" });
    const job = await runSource(docsSource);
    expect(job?.status).toBe("succeeded");

    const docs = await query<{ canonical_url: string; status: string }>("select canonical_url, status from documents where source_id = $1 order by canonical_url", [docsSource]);
    const indexed = docs.filter((d) => d.status === "indexed").map((d) => d.canonical_url.replace(site.base, ""));
    expect(indexed).toEqual(expect.arrayContaining(["/docs", "/docs/shielded", "/docs/loop-a"]));
    // Outside the /docs prefix: never fetched. Private: disallowed by robots.txt, never fetched.
    expect(site.hits.get("/elsewhere")).toBeUndefined();
    expect(site.hits.get("/private/secret")).toBeUndefined();
    // Each loop page fetched once.
    expect(site.hits.get("/docs/loop-a")).toBe(1);
    expect(site.hits.get("/docs/loop-b")).toBe(1);

    const source = await queryOne<{ last_success_at: Date | null; last_error: string | null }>("select last_success_at, last_error from sources where id = $1", [docsSource]);
    expect(source?.last_success_at).not.toBeNull();
    expect(source?.last_error).toBeNull();
  });

  it("detects duplicate content across URLs", async () => {
    const dup = await queryOne<{ status: string; duplicate_of: string | null }>(
      "select status, duplicate_of from documents where canonical_url = $1",
      [`${site.base}/docs/loop-b`],
    );
    expect(dup?.status).toBe("duplicate");
    expect(dup?.duplicate_of).not.toBeNull();
  });

  it("skips unchanged pages and re-indexes changed ones with a new version", async () => {
    resetFetcherState();
    await query("update sources set next_run_at = now() where id = $1", [docsSource]);
    const before = await queryOne<{ version: number; content_hash: string }>("select version, content_hash from documents where canonical_url = $1", [`${site.base}/docs/shielded`]);
    await runSource(docsSource);
    const unchanged = await queryOne<{ version: number }>("select version from documents where canonical_url = $1", [`${site.base}/docs/shielded`]);
    expect(unchanged?.version).toBe(before?.version);

    site.pages.set("/docs/shielded", {
      type: "text/html",
      body: html("Shielded transactions", `<h1>Shielded transactions</h1><p>Updated: Orchard shielded transactions use Halo 2 proofs, which need no trusted setup.</p>${LONG("orchard pool")}`),
    });
    await runSource(docsSource);
    const changed = await queryOne<{ version: number; content_hash: string; last_changed_at: Date }>(
      "select version, content_hash, last_changed_at from documents where canonical_url = $1",
      [`${site.base}/docs/shielded`],
    );
    expect(changed?.version).toBe((before?.version ?? 0) + 1);
    expect(changed?.content_hash).not.toBe(before?.content_hash);
  });

  it("records failures without claiming success", async () => {
    const missing = await addSource("url", `${site.base}/does-not-exist`);
    const job = await runSource(missing);
    // First attempt fails and is re-queued for retry with backoff.
    const row = await queryOne<{ status: string; error: string; attempts: number }>("select status, error, attempts from ingestion_jobs where source_id = $1", [missing]);
    expect(job?.status ?? row?.status).toBe("queued");
    expect(row?.error).toMatch(/No documents were indexed/);
    const doc = await queryOne<{ status: string; error: string }>("select status, error from documents where canonical_url = $1", [`${site.base}/does-not-exist`]);
    expect(doc?.status).toBe("failed");
    expect(doc?.error).toMatch(/404/);
    const source = await queryOne<{ last_success_at: Date | null; last_error: string }>("select last_success_at, last_error from sources where id = $1", [missing]);
    expect(source?.last_success_at).toBeNull();
    expect(source?.last_error).toBeTruthy();
  });

  it("ingests RSS items by fetching the linked pages", async () => {
    const feed = site.pages.get("/feed.xml")!;
    feed.body = feed.body.replace("__BASE__", site.base);
    const id = await addSource("rss", `${site.base}/feed.xml`, { trust: "reputable" });
    const job = await runSource(id);
    expect(job?.status).toBe("succeeded");
    const doc = await queryOne<{ status: string; published_at: Date | null }>("select status, published_at from documents where canonical_url = $1", [`${site.base}/news/upgrade`]);
    expect(doc?.status).toBe("indexed");
    expect(doc?.published_at?.toISOString()).toBe("2024-10-01T10:00:00.000Z");
  });
});

describe("retrieval", () => {
  it("finds the relevant passage with keyword search", async () => {
    const { candidates, usedVectors } = await searchKnowledgeBase("How do Orchard shielded transactions avoid a trusted setup?");
    expect(usedVectors).toBe(false);
    expect(candidates[0].url).toBe(`${site.base}/docs/shielded`);
    expect(candidates[0].snippet).toMatch(/Halo 2/);
    expect(candidates[0].trust).toBe("official");
  });

  it("excludes documents from disabled sources", async () => {
    await query("update sources set enabled = false where name = 'Test docs'");
    const { candidates } = await searchKnowledgeBase("Orchard Halo 2 trusted setup");
    expect(candidates.find((c) => c.url.includes("/docs/shielded"))).toBeUndefined();
    await query("update sources set enabled = true where name = 'Test docs'");
  });

  it("builds numbered evidence and validates citations against it", async () => {
    const plan = { ...heuristicPlan("How do Orchard shielded transactions avoid a trusted setup?"), needs_live_search: false };
    const { sources, status } = await retrievalForTesting.retrieve(plan, {});
    expect(status.knowledgeBase.searched).toBe(true);
    expect(status.liveSearch.used).toBe(false);
    expect(sources[0].ref).toBe(1);
    const check = validateCitations(`Orchard uses Halo 2 proofs, which need no trusted setup [1]. Something else [${sources.length + 5}].`, sources);
    expect(check.cited).toEqual([1]);
    expect(check.invalid).toEqual([sources.length + 5]);
    expect(check.weak).toEqual([]);
  });
});
