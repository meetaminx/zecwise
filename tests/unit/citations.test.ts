import { describe, expect, it } from "vitest";
import { supportScore, validateCitations } from "@/lib/citations/validate";
import type { EvidenceSource } from "@/lib/retrieval/types";

const source = (ref: number, url: string, snippet: string): EvidenceSource => ({
  ref,
  kind: "kb",
  url,
  title: `Source ${ref}`,
  publisher: null,
  publishedAt: null,
  retrievedAt: new Date().toISOString(),
  trust: "official",
  snippet,
  documentId: null,
  chunkId: null,
  score: 1,
  flags: [],
});

const sources = [
  source(1, "https://zips.z.cash/zip-0316", "ZIP 316 specifies unified addresses, which bundle receivers for multiple shielded pools."),
  source(2, "https://z.cash/learn/what-is-zcash", "Zcash launched in October 2016 as a privacy-focused cryptocurrency."),
];

describe("validateCitations", () => {
  it("keeps valid markers and removes ones that reference no retrieved source", () => {
    const result = validateCitations("Unified addresses bundle receivers for several pools [1]. Zcash launched in 2016 [2, 7]. Halo 2 removed trusted setup [9].", sources);
    expect(result.cited).toEqual([1, 2]);
    expect(result.invalid).toEqual([7, 9]);
    expect(result.text).toContain("[2]");
    expect(result.text).not.toContain("[9]");
    expect(result.text).not.toContain("7");
  });
  it("flags URLs in the text that were not retrieved", () => {
    const result = validateCitations("See https://zips.z.cash/zip-0316 and https://made-up.example/zcash-guide.", sources);
    expect(result.unverifiedUrls).toEqual(["https://made-up.example/zcash-guide"]);
  });
  it("flags citations whose passage does not support the sentence", () => {
    const result = validateCitations("Monero uses ring signatures and stealth addresses for sender privacy [2].", sources);
    expect(result.weak.map((w) => w.ref)).toEqual([2]);
    const ok = validateCitations("Zcash launched in October 2016 [2].", sources);
    expect(ok.weak).toEqual([]);
  });
  it("maps citations to paragraphs", () => {
    const result = validateCitations("First claim [1].\n\nNo citation here.\n\nSecond claim [2].", sources);
    expect(result.paragraphs).toEqual([
      { index: 0, refs: [1] },
      { index: 2, refs: [2] },
    ]);
  });
});

describe("supportScore", () => {
  it("is high for paraphrases and low for unrelated claims", () => {
    expect(supportScore("Unified addresses bundle receivers for multiple pools", sources[0].snippet)).toBeGreaterThan(0.6);
    expect(supportScore("Bitcoin uses proof of work mining", sources[0].snippet)).toBeLessThan(0.2);
  });
});
