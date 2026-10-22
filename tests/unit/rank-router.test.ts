import { describe, expect, it } from "vitest";
import { heuristicPlan } from "@/lib/ai/router";
import { freshnessFactor, rankCandidates, reciprocalRankFusion } from "@/lib/retrieval/rank";
import type { Candidate } from "@/lib/retrieval/types";
import { trustForUrl } from "@/lib/search/trust";

const cand = (url: string, score: number, trust: Candidate["trust"], publishedAt: string | null = null, snippet = url): Candidate => ({
  kind: "web", url, title: url, publisher: null, publishedAt, retrievedAt: new Date().toISOString(), trust, snippet, documentId: null, chunkId: null, score, flags: [],
});

describe("ranking", () => {
  it("fuses ranked lists", () => {
    const fused = reciprocalRankFusion([["a", "b"], ["b", "c"]]);
    expect(fused.get("b")).toBeGreaterThan(fused.get("a")!);
  });
  it("prefers authoritative sources at similar relevance", () => {
    const ranked = rankCandidates([cand("https://blog.example/x", 0.9, "unverified"), cand("https://zips.z.cash/zip-0316", 0.85, "official")], { timeSensitive: false, limit: 2 });
    expect(ranked[0].url).toBe("https://zips.z.cash/zip-0316");
  });
  it("prefers recent sources for time-sensitive questions only", () => {
    const old = new Date(Date.now() - 900 * 86_400_000).toISOString();
    const recent = new Date(Date.now() - 10 * 86_400_000).toISOString();
    expect(freshnessFactor(recent, true)).toBeGreaterThan(freshnessFactor(old, true));
    expect(freshnessFactor(old, false)).toBeGreaterThanOrEqual(0.9);
  });
  it("caps passages per URL and removes duplicate snippets", () => {
    const ranked = rankCandidates(
      [cand("https://a.example", 1, "official", null, "one"), cand("https://a.example", 0.9, "official", null, "two"), cand("https://a.example", 0.8, "official", null, "three"), cand("https://b.example", 0.5, "official", null, "one")],
      { timeSensitive: false, limit: 10 },
    );
    expect(ranked.map((r) => r.snippet)).toEqual(["one", "two"]);
  });
  it("assigns trust by host", () => {
    expect(trustForUrl("https://zips.z.cash/zip-0316")).toBe("official");
    expect(trustForUrl("https://github.com/zcash/zcash/releases")).toBe("primary");
    expect(trustForUrl("https://random.blog/zcash")).toBe("unverified");
  });
});

describe("heuristicPlan", () => {
  it("routes general questions away from Zcash retrieval", () => {
    const plan = heuristicPlan("What's a good recipe for banana bread?");
    expect(plan.needs_knowledge_base).toBe(false);
    expect(plan.categories).toContain("other_general_knowledge");
  });
  it("detects Zcash topics without the word Zcash and freshness needs", () => {
    expect(heuristicPlan("How do viewing keys work with Orchard?").needs_knowledge_base).toBe(true);
    const fresh = heuristicPlan("What's the latest zcashd release?");
    expect(fresh.needs_live_search).toBe(true);
    expect(fresh.time_sensitive).toBe(true);
  });
  it("detects comparisons and how-to questions", () => {
    expect(heuristicPlan("How is Zcash different from Monero?").categories).toContain("blockchain_comparisons");
    expect(heuristicPlan("How do I send ZEC from a shielded address?").is_how_to).toBe(true);
  });
});
