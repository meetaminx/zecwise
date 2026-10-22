import type { EvidenceSource } from "@/lib/retrieval/types";

export type CitationCheck = {
  /** Source refs the answer cited that exist in the retrieved set. */
  cited: number[];
  /** Markers that referenced no retrieved source; they are removed from the stored answer. */
  invalid: number[];
  /** Cited refs whose passage shares little vocabulary with the sentence citing it. */
  weak: Array<{ ref: number; sentence: string; support: number }>;
  /** URLs written into the answer text that are not the URL of any retrieved source. */
  unverifiedUrls: string[];
  /** Answer text with invalid markers removed. */
  text: string;
  /** Per-paragraph mapping of citations, for claim-level display. */
  paragraphs: Array<{ index: number; refs: number[] }>;
};

const MARKER = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g;
const STOP = new Set(
  "a an the and or but if then than that this these those is are was were be been being of to in on for with by as at from into about over under it its it's their there they them we you your our not no can could should would will may might must do does did has have had which who whom what when where why how also more most such other some any each all very just so only".split(" "),
);

function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9.\-']*/g) ?? [])
    .map((t) => t.replace(/[.']+$/, "").replace(/(ing|ed|es|s)$/, ""))
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/** Share of the sentence's content words that appear in the passage (0..1). */
export function supportScore(sentence: string, passage: string): number {
  const s = [...new Set(terms(sentence.replace(MARKER, "")))];
  if (!s.length) return 1;
  const p = new Set(terms(passage));
  return s.filter((t) => p.has(t)).length / s.length;
}

function sentencesWithMarkers(text: string): Array<{ sentence: string; refs: number[] }> {
  const out: Array<{ sentence: string; refs: number[] }> = [];
  for (const sentence of text.split(/(?<=[.!?:])\s+(?=[A-Z0-9*_\-#(])|\n+/)) {
    const refs: number[] = [];
    for (const m of sentence.matchAll(MARKER)) for (const n of m[1].split(",")) refs.push(Number(n.trim()));
    if (refs.length) out.push({ sentence: sentence.trim(), refs });
  }
  return out;
}

/**
 * Validates citation markers in a generated answer against the sources that
 * were actually retrieved for it. Nothing outside `sources` can be presented as
 * a citation.
 */
export function validateCitations(text: string, sources: EvidenceSource[], { weakThreshold = 0.15 } = {}): CitationCheck {
  const byRef = new Map(sources.map((s) => [s.ref, s]));
  const cited = new Set<number>();
  const invalid = new Set<number>();

  const cleaned = text.replace(MARKER, (_match, group: string) => {
    const refs = group.split(",").map((n) => Number(n.trim()));
    const good = refs.filter((n) => byRef.has(n));
    refs.filter((n) => !byRef.has(n)).forEach((n) => invalid.add(n));
    good.forEach((n) => cited.add(n));
    return good.length ? `[${good.join(", ")}]` : "";
  });

  const weak: CitationCheck["weak"] = [];
  for (const { sentence, refs } of sentencesWithMarkers(cleaned)) {
    for (const ref of refs) {
      const source = byRef.get(ref);
      if (!source) continue;
      const support = supportScore(sentence, `${source.title}\n${source.snippet}`);
      if (support < weakThreshold) weak.push({ ref, sentence: sentence.slice(0, 300), support: Number(support.toFixed(2)) });
    }
  }

  const known = new Set(sources.map((s) => s.url.replace(/\/$/, "").toLowerCase()));
  const unverifiedUrls = [...new Set((cleaned.match(/https?:\/\/[^\s)\]>"'`]+/g) ?? []).map((u) => u.replace(/[.,;:]+$/, "")))].filter(
    (u) => !known.has(u.replace(/\/$/, "").toLowerCase()),
  );

  const paragraphs = cleaned.split(/\n{2,}/).map((para, index) => {
    const refs = new Set<number>();
    for (const m of para.matchAll(MARKER)) for (const n of m[1].split(",")) refs.add(Number(n.trim()));
    return { index, refs: [...refs] };
  });

  return {
    cited: [...cited].sort((a, b) => a - b),
    invalid: [...invalid].sort((a, b) => a - b),
    weak,
    unverifiedUrls,
    text: cleaned.replace(/[ \t]+([.,;:])/g, "$1"),
    paragraphs: paragraphs.filter((p) => p.refs.length),
  };
}
