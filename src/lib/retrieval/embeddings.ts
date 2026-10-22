import "server-only";
import { config } from "@/lib/config";
import { HttpError, fetchWithTimeout, isRetryableStatus, withRetry } from "@/lib/http";

export function embeddingsEnabled(): boolean {
  return Boolean(config.embeddings.voyageKey);
}

export function toPgVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

/**
 * Voyage AI embeddings (requires VOYAGE_API_KEY). Returns null when the provider
 * is not configured so callers can fall back to keyword-only retrieval.
 */
export async function embed(texts: string[], inputType: "document" | "query"): Promise<{ vectors: number[][]; tokens: number } | null> {
  if (!config.embeddings.voyageKey || texts.length === 0) return null;
  const vectors: number[][] = [];
  let tokens = 0;
  for (let i = 0; i < texts.length; i += 64) {
    const batch = texts.slice(i, i + 64);
    const json = await withRetry(async () => {
      const res = await fetchWithTimeout("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        timeoutMs: 30_000,
        headers: { "content-type": "application/json", authorization: `Bearer ${config.embeddings.voyageKey}` },
        body: JSON.stringify({ input: batch, model: config.embeddings.model, input_type: inputType, output_dimension: config.embeddings.dimensions }),
      });
      if (!res.ok) throw new HttpError(`Voyage embeddings failed: HTTP ${res.status} ${await res.text()}`, res.status, isRetryableStatus(res.status));
      return (await res.json()) as { data: Array<{ embedding: number[]; index: number }>; usage?: { total_tokens?: number } };
    });
    for (const row of json.data.sort((a, b) => a.index - b.index)) vectors.push(row.embedding);
    tokens += json.usage?.total_tokens ?? 0;
  }
  return { vectors, tokens };
}
