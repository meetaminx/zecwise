import "server-only";
import { query } from "@/lib/db";
import { embed, embeddingsEnabled, toPgVector } from "./embeddings";
import { reciprocalRankFusion } from "./rank";
import type { Candidate, Trust } from "./types";
import { config } from "@/lib/config";
import { recordUsage } from "@/lib/usage";

type ChunkRow = {
  chunk_id: string;
  document_id: string;
  heading: string | null;
  content: string;
  canonical_url: string;
  title: string;
  publisher: string | null;
  published_at: Date | null;
  retrieved_at: Date | null;
  trust: Trust;
  injection_flags: string[];
};

// Only indexed documents from enabled (or unattached) sources are retrievable.
const ELIGIBLE = `d.status = 'indexed' and (d.source_id is null or s.enabled)`;
const SELECT = `c.id as chunk_id, d.id as document_id, c.heading, c.content, d.canonical_url, d.title, d.publisher, d.published_at,
  d.retrieved_at, coalesce(s.trust, d.trust) as trust, d.injection_flags`;

/**
 * Hybrid search over the curated knowledge base: Postgres full-text search
 * (OR-ed terms, ranked by cover density) fused with pgvector cosine similarity
 * when embeddings are configured.
 */
export async function searchKnowledgeBase(text: string, { limit = 24 }: { limit?: number } = {}): Promise<{ candidates: Candidate[]; usedVectors: boolean }> {
  const keywordPromise = query<ChunkRow & { rank: number }>(
    `with q as (
       select to_tsquery('english', nullif(replace(plainto_tsquery('english', $1)::text, '&', '|'), '')) as tsq
     )
     select ${SELECT}, ts_rank_cd(c.tsv, q.tsq, 32) as rank
     from q, chunks c join documents d on d.id = c.document_id left join sources s on s.id = d.source_id
     where q.tsq is not null and c.tsv @@ q.tsq and ${ELIGIBLE}
     order by rank desc limit $2`,
    [text, limit],
  );

  let vectorRows: ChunkRow[] = [];
  let usedVectors = false;
  if (embeddingsEnabled()) {
    const result = await embed([text], "query");
    if (result?.vectors[0]) {
      usedVectors = true;
      void recordUsage({ kind: "embedding", provider: "voyage", model: config.embeddings.model, inputTokens: result.tokens, purpose: "query" });
      vectorRows = await query<ChunkRow>(
        `select ${SELECT}
         from chunks c join documents d on d.id = c.document_id left join sources s on s.id = d.source_id
         where c.embedding is not null and ${ELIGIBLE}
         order by c.embedding <=> $1::vector limit $2`,
        [toPgVector(result.vectors[0]), limit],
      );
    }
  }
  const keywordRows = await keywordPromise;

  const fused = reciprocalRankFusion([keywordRows.map((r) => r.chunk_id), vectorRows.map((r) => r.chunk_id)]);
  const byId = new Map<string, ChunkRow>();
  for (const row of [...keywordRows, ...vectorRows]) byId.set(row.chunk_id, row);

  // Normalise RRF to roughly 0..1 so KB and web scores are comparable.
  const max = Math.max(...fused.values(), 1e-9);
  const candidates: Candidate[] = [...fused.entries()].map(([id, score]) => {
    const row = byId.get(id)!;
    return {
      kind: "kb",
      url: row.canonical_url,
      title: row.title || row.canonical_url,
      publisher: row.publisher,
      publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
      retrievedAt: (row.retrieved_at ? new Date(row.retrieved_at) : new Date()).toISOString(),
      trust: row.trust,
      snippet: row.heading ? `${row.heading}\n${row.content}` : row.content,
      documentId: row.document_id,
      chunkId: row.chunk_id,
      score: score / max,
      flags: row.injection_flags ?? [],
    };
  });
  return { candidates, usedVectors };
}
