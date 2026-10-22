import "server-only";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { config } from "@/lib/config";
import { errorMessage, log } from "@/lib/log";
import { recordUsage } from "@/lib/usage";
import { CATEGORIES, type Category } from "./categories";
import { getAnthropic } from "./client";
import { ROUTER_PROMPT } from "./prompts";

export const RetrievalPlanSchema = z.object({
  categories: z.array(z.enum(CATEGORIES)).min(1),
  needs_knowledge_base: z.boolean(),
  needs_live_search: z.boolean(),
  time_sensitive: z.boolean(),
  recency_days: z.number().int().nullable(),
  search_query: z.string(),
  is_how_to: z.boolean(),
});

export type RetrievalPlan = z.infer<typeof RetrievalPlanSchema> & { plannedBy: "model" | "heuristic" };

export type HistoryTurn = { role: "user" | "assistant"; content: string };

const ZCASH_HINT = /\b(zcash|zec|zatoshi|shielded|sapling|orchard|sprout|halo ?2?|zk-?snarks?|zero[- ]knowledge|viewing key|unified address|z-?addr|t-?addr|zashi|ywallet|zingo|nighthawk|zebra|zcashd|zip-?\d+|nu\d|electric coin|zcash foundation|zfnd|ecc|turnstile|memo field|privacy coin)\b/i;
const FRESH_HINT = /\b(latest|recent|recently|current|currently|now|today|this (week|month|year)|news|upcoming|roadmap|release|released|upgrade|price|202\d)\b/i;
const COMPARE_HINT = /\b(vs\.?|versus|compared?|difference|differ|better than|monero|bitcoin|ethereum|litecoin|dash|grin|secret network)\b/i;
const HOWTO_HINT = /^(how (do|can|to|should)|steps?|guide|walk me through|set ?up|install|send|receive|migrate|back ?up|restore)\b/i;

/** Keyword fallback used when the model planner is unavailable or fails. */
export function heuristicPlan(message: string): RetrievalPlan {
  const zcash = ZCASH_HINT.test(message);
  const compare = COMPARE_HINT.test(message) && (zcash || /\bprivacy\b/i.test(message));
  const fresh = FRESH_HINT.test(message);
  const categories: Category[] = [];
  if (compare) categories.push("blockchain_comparisons");
  if (zcash && /\bwallet|send|receive|address\b/i.test(message)) categories.push("wallets_workflows");
  if (zcash && fresh) categories.push("network_protocol_updates");
  if (zcash && !categories.length) categories.push("zcash_fundamentals");
  if (!categories.length) categories.push(message.trim().split(/\s+/).length <= 4 ? "general_conversation" : "other_general_knowledge");
  const relevant = zcash || compare;
  return {
    categories,
    needs_knowledge_base: relevant,
    needs_live_search: relevant && fresh,
    time_sensitive: fresh,
    recency_days: fresh ? 180 : null,
    search_query: message.slice(0, 300),
    is_how_to: HOWTO_HINT.test(message.trim()),
    plannedBy: "heuristic",
  };
}

/** Classifies the message and plans retrieval with a small structured-output model call. */
export async function planRetrieval(message: string, history: HistoryTurn[]): Promise<RetrievalPlan> {
  const recent = history
    .slice(-6)
    .map((t) => `${t.role === "user" ? "User" : "ZecWise"}: ${t.content.slice(0, 1200)}`)
    .join("\n\n");
  try {
    const response = await getAnthropic().messages.parse({
      model: config.llm.routerModel,
      max_tokens: 2000,
      system: ROUTER_PROMPT,
      output_config: { effort: "low", format: zodOutputFormat(RetrievalPlanSchema) },
      messages: [
        {
          role: "user",
          content: `<conversation>\n${recent || "(no earlier turns)"}\n</conversation>\n<latest_message>\n${message}\n</latest_message>`,
        },
      ],
    });
    void recordUsage({
      kind: "llm",
      provider: "anthropic",
      model: config.llm.routerModel,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      purpose: "router",
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error(`Planner returned no plan (stop_reason=${response.stop_reason})`);
    return { ...response.parsed_output, plannedBy: "model" };
  } catch (err) {
    log("warn", "router.fallback_heuristic", { error: errorMessage(err) });
    return heuristicPlan(message);
  }
}
