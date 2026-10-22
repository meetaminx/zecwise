import { XMLParser } from "fast-xml-parser";
import * as cheerio from "cheerio";

export type FeedItem = { title: string; url: string; publishedAt: string | null; author: string | null; summary: string };

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object" && "#text" in (value as Record<string, unknown>)) return String((value as Record<string, unknown>)["#text"]);
  return "";
}

function htmlToText(html: string): string {
  if (!/[<&]/.test(html)) return html.trim();
  return cheerio.load(html).root().text().replace(/\s+/g, " ").trim();
}

function date(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const asArray = <T,>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Parses RSS 2.0 and Atom feeds into a flat list of items. */
export function parseFeed(xml: string): { title: string; items: FeedItem[] } {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: true });
  const doc = parser.parse(xml);
  if (doc.rss?.channel) {
    const channel = doc.rss.channel;
    return {
      title: text(channel.title),
      items: asArray(channel.item)
        .map((item: Record<string, unknown>) => ({
          title: htmlToText(text(item.title)),
          url: text(item.link) || text((item.guid as Record<string, unknown>) ?? item.guid),
          publishedAt: date(item.pubDate ?? item["dc:date"]),
          author: text(item["dc:creator"] ?? item.author) || null,
          summary: htmlToText(text(item["content:encoded"] ?? item.description)),
        }))
        .filter((i) => i.url),
    };
  }
  if (doc.feed) {
    const feed = doc.feed;
    return {
      title: text(feed.title),
      items: asArray(feed.entry)
        .map((entry: Record<string, unknown>) => {
          const links = asArray(entry.link as Record<string, string> | Record<string, string>[]);
          const link = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
          const author = entry.author as Record<string, unknown> | undefined;
          return {
            title: htmlToText(text(entry.title)),
            url: link?.["@_href"] ?? "",
            publishedAt: date(entry.published ?? entry.updated),
            author: author ? text(author.name) || null : null,
            summary: htmlToText(text(entry.content ?? entry.summary)),
          };
        })
        .filter((i) => i.url),
    };
  }
  throw new Error("Not a recognised RSS or Atom feed");
}

/** Accepts "owner/repo" or a github.com repository URL. */
export function parseGithubRepo(value: string): { owner: string; repo: string } {
  const match = value.trim().match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/.*)?$/i);
  if (!match) throw new Error(`Not a GitHub repository: ${value}`);
  return { owner: match[1], repo: match[2] };
}
