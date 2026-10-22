import type { Candidate, Trust } from "./types";

export const TRUST_WEIGHT: Record<Trust, number> = {
  official: 1.0,
  primary: 0.95,
  reputable: 0.85,
  community: 0.7,
  unverified: 0.55,
};

/** Reciprocal rank fusion of several ranked id lists (k = 60, as in Cormack et al. 2009). */
export function reciprocalRankFusion(lists: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, index) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1)));
  }
  return scores;
}

/**
 * Freshness multiplier. For time-sensitive questions content decays with a
 * 120-day half-life (floored at 0.35); otherwise age barely matters, so stable
 * specifications are not penalised for being old.
 */
export function freshnessFactor(dateIso: string | null, timeSensitive: boolean, now = Date.now()): number {
  if (!dateIso) return timeSensitive ? 0.6 : 1;
  const ageDays = Math.max(0, (now - new Date(dateIso).getTime()) / 86_400_000);
  if (!timeSensitive) return Math.max(0.9, 1 - ageDays / 3650);
  return Math.max(0.35, 0.5 ** (ageDays / 120));
}

/**
 * Final ordering: relevance score scaled by source authority and freshness, then
 * capped per URL so one long page cannot crowd out other sources.
 */
export function rankCandidates(candidates: Candidate[], { timeSensitive, limit, perUrl = 2 }: { timeSensitive: boolean; limit: number; perUrl?: number }): Candidate[] {
  const scored = candidates.map((c) => {
    const flagPenalty = c.flags.length ? 0.6 : 1;
    return { ...c, score: c.score * TRUST_WEIGHT[c.trust] * freshnessFactor(c.publishedAt, timeSensitive) * flagPenalty };
  });
  scored.sort((a, b) => b.score - a.score);
  const perUrlCount = new Map<string, number>();
  const seenSnippets = new Set<string>();
  const out: Candidate[] = [];
  for (const c of scored) {
    const n = perUrlCount.get(c.url) ?? 0;
    const key = c.snippet.slice(0, 160).toLowerCase();
    if (n >= perUrl || seenSnippets.has(key)) continue;
    perUrlCount.set(c.url, n + 1);
    seenSnippets.add(key);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}
