import "server-only";
import { query } from "@/lib/db";
import { log, errorMessage } from "@/lib/log";

/**
 * Price table in USD per million tokens (or per 1,000 requests for search).
 * These are estimates for the dashboard; check provider pricing pages for
 * current rates and override with ZECWISE_PRICE_OVERRIDES (JSON) if needed.
 */
const DEFAULT_PRICES: Record<string, { input?: number; output?: number; perThousandRequests?: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "voyage-3.5": { input: 0.06 },
  tavily: { perThousandRequests: 8 },
  brave: { perThousandRequests: 5 },
};

function prices() {
  try {
    return { ...DEFAULT_PRICES, ...(process.env.ZECWISE_PRICE_OVERRIDES ? JSON.parse(process.env.ZECWISE_PRICE_OVERRIDES) : {}) };
  } catch {
    return DEFAULT_PRICES;
  }
}

export function estimateCost(key: string, inputTokens: number, outputTokens: number, units = 0): number | null {
  const p = prices()[key];
  if (!p) return null;
  return ((p.input ?? 0) * inputTokens + (p.output ?? 0) * outputTokens) / 1_000_000 + ((p.perThousandRequests ?? 0) * units) / 1000;
}

export async function recordUsage(e: {
  kind: "llm" | "embedding" | "search";
  provider: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  units?: number;
  purpose?: string;
}) {
  try {
    await query(
      `insert into usage_events (kind, provider, model, input_tokens, output_tokens, units, est_cost_usd, purpose)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        e.kind,
        e.provider,
        e.model ?? null,
        e.inputTokens ?? 0,
        e.outputTokens ?? 0,
        e.units ?? 0,
        estimateCost(e.model ?? e.provider, e.inputTokens ?? 0, e.outputTokens ?? 0, e.units ?? 0),
        e.purpose ?? null,
      ],
    );
  } catch (err) {
    log("warn", "usage.record_failed", { error: errorMessage(err) });
  }
}
