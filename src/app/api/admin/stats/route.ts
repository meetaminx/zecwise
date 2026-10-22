import { handle } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { featureStatus } from "@/lib/config";
import { queryOne, query } from "@/lib/db";

export const GET = handle(async () => {
  await requireRole("viewer");
  const [docs, sources, jobs, retrieval, costs, feedback, chunks] = await Promise.all([
    query<{ status: string; n: number }>("select status, count(*)::int as n from documents group by status"),
    queryOne("select count(*)::int as total, count(*) filter (where enabled)::int as enabled, count(*) filter (where last_error is not null)::int as with_errors from sources"),
    query<{ status: string; n: number }>("select status, count(*)::int as n from ingestion_jobs where created_at > now() - interval '30 days' group by status"),
    queryOne(`select count(*)::int as total_7d, count(*) filter (where used_kb)::int as kb_7d, count(*) filter (where used_live)::int as live_7d,
                     coalesce(avg(kb_results + web_results), 0)::float as avg_sources
              from retrieval_events where created_at > now() - interval '7 days'`),
    query(`select kind, provider, coalesce(sum(est_cost_usd), 0)::float as est_cost_usd, sum(input_tokens)::bigint as input_tokens,
                  sum(output_tokens)::bigint as output_tokens, sum(units)::int as units, count(*)::int as calls
           from usage_events where created_at > now() - interval '30 days' group by kind, provider order by kind`),
    queryOne("select count(*) filter (where rating = 1)::int as up, count(*) filter (where rating = -1)::int as down from feedback where created_at > now() - interval '30 days'"),
    queryOne("select count(*)::int as total, count(*) filter (where embedding is not null)::int as embedded from chunks"),
  ]);
  return Response.json({ documents: docs, sources, jobs, retrieval, costs, feedback, chunks, features: featureStatus() });
});
