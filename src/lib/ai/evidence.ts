import { neutralizeMarkup } from "@/lib/ingestion/injection";
import type { EvidenceSource } from "@/lib/retrieval/types";

export type RetrievalStatus = {
  knowledgeBase: { searched: boolean; results: number; note?: string };
  liveSearch: { used: boolean; provider: string; results: number; note?: string };
  date: string;
};

function attr(value: string | null | undefined): string {
  return (value ?? "").replace(/["<>\n]/g, " ").slice(0, 300);
}

export function formatRetrievalStatus(s: RetrievalStatus): string {
  const kb = s.knowledgeBase.searched
    ? `Knowledge base: searched, ${s.knowledgeBase.results} relevant passage(s) found.`
    : `Knowledge base: not searched${s.knowledgeBase.note ? ` (${s.knowledgeBase.note})` : ""}.`;
  const live = s.liveSearch.used
    ? `Live web search: ran via ${s.liveSearch.provider}, ${s.liveSearch.results} result(s).`
    : `Live web search: did not run${s.liveSearch.note ? ` (${s.liveSearch.note})` : ""}.`;
  return `<retrieval_status>\n${kb}\n${live}\nToday's date: ${s.date}\n</retrieval_status>`;
}

/** Wraps retrieved passages as clearly delimited, untrusted evidence. */
export function formatEvidence(sources: EvidenceSource[]): string {
  if (!sources.length) return "<evidence>\n(no sources were retrieved for this turn)\n</evidence>";
  const blocks = sources.map((s) => {
    const attrs = [
      `ref="${s.ref}"`,
      `kind="${s.kind === "kb" ? "knowledge_base" : "live_web"}"`,
      `trust="${s.trust}"`,
      `title="${attr(s.title)}"`,
      `url="${attr(s.url)}"`,
      s.publisher ? `publisher="${attr(s.publisher)}"` : null,
      s.publishedAt ? `published="${s.publishedAt.slice(0, 10)}"` : `published="unknown"`,
      `retrieved="${s.retrievedAt.slice(0, 10)}"`,
      s.flags.length ? `flagged="${s.flags.join(",")}"` : null,
    ]
      .filter(Boolean)
      .join(" ");
    return `<source ${attrs}>\n${neutralizeMarkup(s.snippet)}\n</source>`;
  });
  return `<evidence>\n${blocks.join("\n")}\n</evidence>`;
}
