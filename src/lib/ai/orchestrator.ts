import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { config, featureStatus } from "@/lib/config";
import { validateCitations, type CitationCheck } from "@/lib/citations/validate";
import { errorMessage, log } from "@/lib/log";
import { searchKnowledgeBase } from "@/lib/retrieval/kb";
import { rankCandidates } from "@/lib/retrieval/rank";
import type { Candidate, EvidenceSource } from "@/lib/retrieval/types";
import { searchWeb, webSearchEnabled } from "@/lib/search/web";
import { recordUsage } from "@/lib/usage";
import { getAnthropic } from "./client";
import { formatEvidence, formatRetrievalStatus, type RetrievalStatus } from "./evidence";
import { PROMPT_VERSION, SYSTEM_PROMPT } from "./prompts";
import { planRetrieval, type HistoryTurn, type RetrievalPlan } from "./router";
import { redactSecrets } from "./secrets";
import { FollowupSplitter } from "./stream-split";

export type ChatEvent =
  | { type: "plan"; plan: RetrievalPlan; status: RetrievalStatus }
  | { type: "sources"; sources: EvidenceSource[] }
  | { type: "delta"; text: string }
  | {
      type: "done";
      text: string;
      followups: string[];
      citations: CitationCheck;
      model: string;
      promptVersion: string;
      usage: { inputTokens: number; outputTokens: number };
      stopReason: string | null;
      redacted: string[];
    }
  | { type: "error"; message: string; code: string };

export type RetrievalOverrides = {
  /** Extra passages appended to retrieval. Used by the evaluation suite to test hostile or conflicting sources. */
  injectSources?: Candidate[];
  /** Skip live retrieval entirely (e.g. for offline evals of model behaviour). */
  disableRetrieval?: boolean;
};

const MAX_SOURCES = 8;

async function retrieve(plan: RetrievalPlan, overrides: RetrievalOverrides): Promise<{ sources: EvidenceSource[]; status: RetrievalStatus; latencyMs: number; errors: string[] }> {
  const started = Date.now();
  const features = featureStatus();
  const status: RetrievalStatus = {
    knowledgeBase: { searched: false, results: 0 },
    liveSearch: { used: false, provider: features.liveSearchProvider, results: 0 },
    date: new Date().toISOString().slice(0, 10),
  };
  const errors: string[] = [];

  const wantKb = plan.needs_knowledge_base && !overrides.disableRetrieval;
  const wantLive = plan.needs_live_search && !overrides.disableRetrieval;
  if (!wantKb) status.knowledgeBase.note = overrides.disableRetrieval ? "retrieval disabled" : "not needed for this question";
  else if (!features.database) status.knowledgeBase.note = "knowledge base not configured";
  if (!wantLive) status.liveSearch.note = overrides.disableRetrieval ? "retrieval disabled" : "not needed for this question";
  else if (!webSearchEnabled()) status.liveSearch.note = "live search is not configured on this server";

  const [kb, web] = await Promise.all([
    wantKb && features.database
      ? searchKnowledgeBase(plan.search_query).catch((err) => {
          errors.push(`knowledge base: ${errorMessage(err)}`);
          status.knowledgeBase.note = "knowledge base search failed";
          return null;
        })
      : Promise.resolve(null),
    wantLive && webSearchEnabled()
      ? searchWeb(plan.search_query, { recencyDays: plan.time_sensitive ? plan.recency_days ?? 365 : undefined }).catch((err) => {
          errors.push(`live search: ${errorMessage(err)}`);
          status.liveSearch.note = "live search failed";
          return null;
        })
      : Promise.resolve(null),
  ]);

  if (kb) status.knowledgeBase.searched = true;
  if (web) status.liveSearch.used = true;

  const candidates: Candidate[] = [...(kb?.candidates ?? []), ...(web ?? []), ...(overrides.injectSources ?? [])];
  const ranked = rankCandidates(candidates, { timeSensitive: plan.time_sensitive, limit: MAX_SOURCES });
  const sources = ranked.map((c, i) => ({ ...c, ref: i + 1 }));
  status.knowledgeBase.results = sources.filter((s) => s.kind === "kb").length;
  status.liveSearch.results = sources.filter((s) => s.kind === "web").length;
  return { sources, status, latencyMs: Date.now() - started, errors };
}

function buildUserTurn(question: string, sources: EvidenceSource[], status: RetrievalStatus, plan: RetrievalPlan, redacted: string[]): string {
  const parts = [formatRetrievalStatus(status), formatEvidence(sources)];
  if (redacted.length) {
    parts.push(
      `<security_notice>The user's message contained what looked like a wallet secret (${redacted.join(", ")}). The server removed it before you saw it. Warn the user clearly that anything they pasted should be considered compromised, and that ZecWise never needs their seed phrase or keys.</security_notice>`,
    );
  }
  if (plan.is_how_to) parts.push("<note>The user is asking how to do something; give clear numbered steps where it helps.</note>");
  parts.push(`<question>\n${question}\n</question>`);
  return parts.join("\n\n");
}

export type ConversationInput = { message: string; history: HistoryTurn[] };

/**
 * The ZecWise answer pipeline: redact secrets, plan retrieval, search the
 * knowledge base and live web as needed, stream a grounded answer, then
 * validate its citations against the retrieved records.
 */
export async function* runConversation(input: ConversationInput, overrides: RetrievalOverrides = {}): AsyncGenerator<ChatEvent, void, void> {
  const { text: question, found: redacted } = redactSecrets(input.message);
  let anthropic: Anthropic;
  try {
    anthropic = getAnthropic();
  } catch (err) {
    yield { type: "error", message: errorMessage(err), code: "llm_not_configured" };
    return;
  }

  const plan = await planRetrieval(question, input.history);
  const { sources, status, latencyMs, errors } = await retrieve(plan, overrides);
  if (errors.length) log("warn", "retrieval.partial_failure", { errors });
  yield { type: "plan", plan, status };
  yield { type: "sources", sources };

  const messages: Anthropic.MessageParam[] = [
    ...input.history.slice(-12).map((t) => ({ role: t.role, content: t.content || "(empty)" }) as Anthropic.MessageParam),
    { role: "user", content: buildUserTurn(question, sources, status, plan, redacted) },
  ];

  const splitter = new FollowupSplitter();
  let raw = "";
  try {
    const stream = anthropic.beta.messages.stream({
      model: config.llm.model,
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: config.llm.answerEffort },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages,
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        raw += event.delta.text;
        const visible = splitter.push(event.delta.text);
        if (visible) yield { type: "delta", text: visible };
      }
    }
    const final = await stream.finalMessage();
    const { rest, followups } = splitter.finish();
    if (rest) yield { type: "delta", text: rest };

    void recordUsage({
      kind: "llm",
      provider: "anthropic",
      model: final.model,
      inputTokens: final.usage.input_tokens + (final.usage.cache_read_input_tokens ?? 0) + (final.usage.cache_creation_input_tokens ?? 0),
      outputTokens: final.usage.output_tokens,
      purpose: "answer",
    });

    if (final.stop_reason === "refusal") {
      yield { type: "error", message: "ZecWise couldn't answer that request.", code: "refusal" };
      return;
    }
    const body = raw.split("<<<FOLLOWUPS>>>")[0].trimEnd();
    const citations = validateCitations(body, sources);
    log("info", "chat.answered", {
      plannedBy: plan.plannedBy,
      categories: plan.categories,
      sources: sources.length,
      cited: citations.cited.length,
      invalidCitations: citations.invalid,
      weakCitations: citations.weak.length,
      retrievalMs: latencyMs,
    });
    yield {
      type: "done",
      text: citations.text,
      followups,
      citations,
      model: final.model,
      promptVersion: PROMPT_VERSION,
      usage: { inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens },
      stopReason: final.stop_reason,
      redacted,
    };
  } catch (err) {
    log("error", "chat.generation_failed", { error: errorMessage(err) });
    yield { type: "error", message: "The AI model request failed. Please try again in a moment.", code: "llm_error" };
  }
}

export const retrievalForTesting = { retrieve };
