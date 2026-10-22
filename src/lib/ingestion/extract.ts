import * as cheerio from "cheerio";
import { normalizeUrl } from "./url";

export type ExtractedDocument = {
  title: string;
  canonicalUrl: string;
  publisher: string | null;
  author: string | null;
  publishedAt: string | null;
  sections: Array<{ heading: string | null; text: string }>;
  text: string;
  links: string[];
  noindex: boolean;
};

const STRIP = "script, style, noscript, template, svg, iframe, form, nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo], [aria-hidden=true], .sidebar, .toc, .breadcrumbs, .cookie, #cookie-banner";

function clean(text: string): string {
  return text.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function parseDate(value: string | undefined | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Pulls the readable main content and metadata out of an HTML page. Headings
 * split the text into sections so chunks keep their local context.
 */
export function extractHtml(html: string, pageUrl: string): ExtractedDocument {
  const $ = cheerio.load(html);
  const meta = (selector: string) => $(selector).attr("content")?.trim() || null;

  const robots = (meta('meta[name="robots"]') ?? "").toLowerCase();
  const canonicalHref = $('link[rel="canonical"]').attr("href");
  let canonicalUrl = normalizeUrl(pageUrl);
  if (canonicalHref) {
    try {
      const candidate = normalizeUrl(canonicalHref, pageUrl);
      // Only trust a canonical on the same host; cross-host canonicals are a common spam/dup vector.
      if (new URL(candidate).host === new URL(canonicalUrl).host) canonicalUrl = candidate;
    } catch {
      /* ignore malformed canonical */
    }
  }

  const title = clean(meta('meta[property="og:title"]') ?? ($("title").first().text() || $("h1").first().text() || pageUrl));
  const publisher = meta('meta[property="og:site_name"]') ?? meta('meta[name="application-name"]');
  const author = meta('meta[name="author"]') ?? meta('meta[property="article:author"]');
  const publishedAt =
    parseDate(meta('meta[property="article:published_time"]')) ??
    parseDate(meta('meta[name="date"]')) ??
    parseDate($("time[datetime]").first().attr("datetime"));

  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || /^(mailto|javascript|tel):/i.test(href)) return;
    try {
      links.push(normalizeUrl(href, pageUrl));
    } catch {
      /* skip */
    }
  });

  $(STRIP).remove();
  const root = $("main").first().length ? $("main").first() : $("article").first().length ? $("article").first() : $("[role=main]").first().length ? $("[role=main]").first() : $("body");

  const sections: Array<{ heading: string | null; text: string }> = [];
  let heading: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    const text = clean(buffer.join("\n"));
    if (text) sections.push({ heading, text });
    buffer = [];
  };
  root.find("h1, h2, h3, h4, p, li, pre, blockquote, td, th, dt, dd").each((_, el) => {
    const tag = el.tagName.toLowerCase();
    const text = clean($(el).text());
    if (!text) return;
    if (/^h[1-4]$/.test(tag)) {
      flush();
      heading = text;
      return;
    }
    // Skip list items / cells that only wrap nested block elements we'll visit anyway.
    if ((tag === "li" || tag === "td") && $(el).find("p, li, pre").length) return;
    buffer.push(tag === "li" ? `- ${text}` : text);
  });
  flush();
  if (!sections.length) {
    const text = clean(root.text());
    if (text) sections.push({ heading: null, text });
  }

  return {
    title,
    canonicalUrl,
    publisher,
    author,
    publishedAt,
    sections,
    text: sections.map((s) => (s.heading ? `## ${s.heading}\n${s.text}` : s.text)).join("\n\n"),
    links: [...new Set(links)],
    noindex: /noindex/.test(robots),
  };
}

export function extractPlainText(text: string, pageUrl: string): ExtractedDocument {
  const body = clean(text);
  const firstLine = body.split("\n").find((l) => l.trim()) ?? pageUrl;
  return {
    title: firstLine.replace(/^#+\s*/, "").slice(0, 200),
    canonicalUrl: normalizeUrl(pageUrl),
    publisher: null,
    author: null,
    publishedAt: null,
    sections: [{ heading: null, text: body }],
    text: body,
    links: [],
    noindex: false,
  };
}
