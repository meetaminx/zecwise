export type Chunk = { ord: number; heading: string | null; content: string; tokenEstimate: number };

/** Rough token estimate (~4 characters per token for English prose). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Splits sections into retrieval-sized passages (about 350 tokens by default)
 * along paragraph and sentence boundaries, with a small overlap so a fact that
 * straddles a boundary is still retrievable.
 */
export function chunkSections(
  sections: Array<{ heading: string | null; text: string }>,
  { targetChars = 1400, overlapChars = 200, minChars = 120 }: { targetChars?: number; overlapChars?: number; minChars?: number } = {},
): Chunk[] {
  const chunks: Chunk[] = [];
  const push = (heading: string | null, content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    // Merge very small trailing fragments into the previous chunk of the same section.
    const prev = chunks[chunks.length - 1];
    if (trimmed.length < minChars && prev && prev.heading === heading && prev.content.length + trimmed.length < targetChars * 1.3) {
      prev.content = `${prev.content}\n${trimmed}`;
      prev.tokenEstimate = estimateTokens(prev.content);
      return;
    }
    chunks.push({ ord: chunks.length, heading, content: trimmed, tokenEstimate: estimateTokens(trimmed) });
  };

  for (const section of sections) {
    const units = section.text
      .split(/\n+/)
      .flatMap((para) => (para.length > targetChars ? para.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [para] : [para]))
      .map((u) => u.trim())
      .filter(Boolean);

    let current = "";
    for (const unit of units) {
      if (current && current.length + unit.length + 1 > targetChars) {
        push(section.heading, current);
        const tail = current.slice(-overlapChars);
        const boundary = tail.search(/[.!?]\s|\n/);
        current = boundary >= 0 ? tail.slice(boundary + 1).trim() : "";
      }
      if (unit.length > targetChars) {
        for (let i = 0; i < unit.length; i += targetChars - overlapChars) push(section.heading, unit.slice(i, i + targetChars));
        current = "";
        continue;
      }
      current = current ? `${current}\n${unit}` : unit;
    }
    push(section.heading, current);
  }
  return chunks.map((c, i) => ({ ...c, ord: i }));
}
