import { describe, expect, it } from "vitest";
import { isAllowed, parseRobots } from "@/lib/ingestion/robots";

const robots = `
User-agent: *
Disallow: /private/
Allow: /private/public-page
Crawl-delay: 2

User-agent: ZecWiseBot
Disallow: /no-zecwise
Disallow: /*.pdf$
`;

describe("robots.txt", () => {
  it("uses the most specific user-agent group", () => {
    const rules = parseRobots(robots, "ZecWiseBot/0.1 (+https://example.org)");
    expect(isAllowed(rules, "/no-zecwise/page")).toBe(false);
    expect(isAllowed(rules, "/paper.pdf")).toBe(false);
    expect(isAllowed(rules, "/paper.pdf?x=1")).toBe(true);
    // The specific group replaces the wildcard group entirely.
    expect(isAllowed(rules, "/private/x")).toBe(true);
  });
  it("applies longest-match precedence with Allow winning ties", () => {
    const rules = parseRobots(robots, "OtherBot/1.0");
    expect(isAllowed(rules, "/private/secret")).toBe(false);
    expect(isAllowed(rules, "/private/public-page")).toBe(true);
    expect(rules.crawlDelaySeconds).toBe(2);
  });
  it("allows everything when there are no rules", () => {
    expect(isAllowed(parseRobots("", "ZecWiseBot"), "/anything")).toBe(true);
  });
});
