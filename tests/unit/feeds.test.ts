import { describe, expect, it } from "vitest";
import { parseFeed, parseGithubRepo } from "@/lib/ingestion/feeds";

describe("parseFeed", () => {
  it("parses RSS 2.0", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Forum</title>
      <item><title>NU7 discussion</title><link>https://forum.example/t/nu7/1</link><pubDate>Tue, 01 Oct 2024 10:00:00 GMT</pubDate>
      <description><![CDATA[<p>Let's talk about <b>NU7</b>.</p>]]></description></item></channel></rss>`;
    const feed = parseFeed(xml);
    expect(feed.title).toBe("Forum");
    expect(feed.items[0]).toMatchObject({ title: "NU7 discussion", url: "https://forum.example/t/nu7/1", publishedAt: "2024-10-01T10:00:00.000Z", summary: "Let's talk about NU7." });
  });
  it("parses Atom", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Releases</title><entry><title>v1.0</title>
      <link rel="alternate" href="https://example.org/v1"/><updated>2024-02-03T00:00:00Z</updated><author><name>dev</name></author><content>Notes</content></entry></feed>`;
    expect(parseFeed(xml).items[0]).toMatchObject({ title: "v1.0", url: "https://example.org/v1", author: "dev" });
  });
  it("rejects non-feeds", () => {
    expect(() => parseFeed("<html></html>")).toThrow();
  });
});

describe("parseGithubRepo", () => {
  it("accepts owner/repo and URLs", () => {
    expect(parseGithubRepo("zcash/zcash")).toEqual({ owner: "zcash", repo: "zcash" });
    expect(parseGithubRepo("https://github.com/ZcashFoundation/zebra/releases")).toEqual({ owner: "ZcashFoundation", repo: "zebra" });
  });
});
