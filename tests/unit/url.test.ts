import { describe, expect, it } from "vitest";
import { assertPublicUrl, normalizeUrl } from "@/lib/ingestion/url";

describe("normalizeUrl", () => {
  it("lowercases host, drops fragments, tracking params and trailing slashes", () => {
    expect(normalizeUrl("HTTPS://Z.Cash:443/learn/?utm_source=x&b=2&a=1#top")).toBe("https://z.cash/learn?a=1&b=2");
  });
  it("keeps the root slash and collapses index.html", () => {
    expect(normalizeUrl("https://zips.z.cash")).toBe("https://zips.z.cash/");
    expect(normalizeUrl("https://example.org/docs/index.html")).toBe("https://example.org/docs");
  });
  it("resolves relative links", () => {
    expect(normalizeUrl("../zip-0316", "https://zips.z.cash/a/b")).toBe("https://zips.z.cash/zip-0316");
  });
  it("rejects non-http schemes", () => {
    expect(() => normalizeUrl("javascript:alert(1)")).toThrow();
    expect(() => normalizeUrl("file:///etc/passwd")).toThrow();
  });
});

describe("assertPublicUrl", () => {
  it("blocks loopback and private ranges", () => {
    for (const u of ["http://localhost/x", "http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data"]) {
      expect(() => assertPublicUrl(u)).toThrow(/private|local/);
    }
    expect(() => assertPublicUrl("https://z.cash/")).not.toThrow();
  });
});
