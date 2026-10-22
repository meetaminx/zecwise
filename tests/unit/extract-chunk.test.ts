import { describe, expect, it } from "vitest";
import { chunkSections } from "@/lib/ingestion/chunk";
import { extractHtml } from "@/lib/ingestion/extract";

const html = `<!doctype html><html><head>
<title>Shielded addresses | Docs</title>
<link rel="canonical" href="/docs/shielded?utm_source=feed">
<meta property="og:site_name" content="Example Docs">
<meta property="article:published_time" content="2024-05-01T00:00:00Z">
</head><body>
<nav><a href="/home">Home</a> navigation junk</nav>
<main>
<h1>Shielded addresses</h1>
<p>Shielded addresses keep the sender, receiver and amount private on-chain.</p>
<h2>Unified addresses</h2>
<p>A unified address bundles receivers for several pools.</p>
<ul><li>Orchard receiver</li><li>Sapling receiver</li></ul>
<a href="/docs/orchard#intro">Orchard</a>
</main>
<footer>Copyright footer</footer>
<script>alert("x")</script>
</body></html>`;

describe("extractHtml", () => {
  const doc = extractHtml(html, "https://example.org/docs/shielded");
  it("extracts metadata and a same-host canonical URL", () => {
    expect(doc.title).toBe("Shielded addresses | Docs");
    expect(doc.canonicalUrl).toBe("https://example.org/docs/shielded");
    expect(doc.publisher).toBe("Example Docs");
    expect(doc.publishedAt).toBe("2024-05-01T00:00:00.000Z");
  });
  it("keeps main content and drops navigation, footer and scripts", () => {
    expect(doc.text).toContain("amount private on-chain");
    expect(doc.text).toContain("- Orchard receiver");
    expect(doc.text).not.toContain("navigation junk");
    expect(doc.text).not.toContain("Copyright footer");
    expect(doc.text).not.toContain("alert");
  });
  it("splits into heading sections and collects normalised links", () => {
    expect(doc.sections.map((s) => s.heading)).toEqual(["Shielded addresses", "Unified addresses"]);
    expect(doc.links).toContain("https://example.org/docs/orchard");
  });
  it("ignores cross-host canonicals", () => {
    const other = extractHtml(html.replace('href="/docs/shielded?utm_source=feed"', 'href="https://spam.example/x"'), "https://example.org/docs/shielded");
    expect(other.canonicalUrl).toBe("https://example.org/docs/shielded");
  });
});

describe("chunkSections", () => {
  it("produces bounded chunks that carry their heading", () => {
    const para = "Zcash uses zero-knowledge proofs to validate shielded transactions without revealing their contents. ";
    const chunks = chunkSections([{ heading: "Proofs", text: Array.from({ length: 40 }, () => para).join("\n") }], { targetChars: 600, overlapChars: 120 });
    expect(chunks.length).toBeGreaterThan(4);
    for (const c of chunks) {
      expect(c.heading).toBe("Proofs");
      expect(c.content.length).toBeLessThanOrEqual(800);
    }
    expect(chunks.map((c) => c.ord)).toEqual(chunks.map((_, i) => i));
  });
  it("merges tiny trailing fragments", () => {
    const chunks = chunkSections([{ heading: null, text: `${"a".repeat(500)}\nshort` }], { targetChars: 510 });
    expect(chunks).toHaveLength(1);
  });
});
