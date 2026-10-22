/**
 * Minimal robots.txt support: honours Allow/Disallow rules (with `*` and `$`
 * wildcards) and Crawl-delay for our user agent or `*`, using the most specific
 * matching group and the longest matching rule, as in RFC 9309.
 */
export type RobotsRules = { allow: string[]; disallow: string[]; crawlDelaySeconds?: number };

export function parseRobots(text: string, userAgent: string): RobotsRules {
  const agentToken = userAgent.split("/")[0].toLowerCase();
  type Group = { agents: string[]; rules: RobotsRules };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { allow: [], disallow: [] } };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" && value) current.rules.allow.push(value);
    else if (field === "disallow" && value) current.rules.disallow.push(value);
    else if (field === "crawl-delay") {
      const delay = Number.parseFloat(value);
      if (Number.isFinite(delay)) current.rules.crawlDelaySeconds = delay;
    }
  }

  const specific = groups.find((g) => g.agents.some((a) => a !== "*" && agentToken.includes(a)));
  const wildcard = groups.find((g) => g.agents.includes("*"));
  return (specific ?? wildcard)?.rules ?? { allow: [], disallow: [] };
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

export function isAllowed(rules: RobotsRules, pathWithQuery: string): boolean {
  let best: { length: number; allow: boolean } | null = null;
  for (const [list, allow] of [
    [rules.allow, true],
    [rules.disallow, false],
  ] as const) {
    for (const pattern of list) {
      if (patternToRegex(pattern).test(pathWithQuery)) {
        const length = pattern.length;
        if (!best || length > best.length || (length === best.length && allow)) best = { length, allow };
      }
    }
  }
  return best ? best.allow : true;
}
