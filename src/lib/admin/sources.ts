import "server-only";
import { query, queryOne } from "@/lib/db";
import { parseGithubRepo } from "@/lib/ingestion/feeds";
import { assertPublicUrl, normalizeUrl } from "@/lib/ingestion/url";
import type { z } from "zod";
import type { SourceInput, SourcePatch } from "./schemas";

export function normalizeSourceUrl(kind: string, url: string): { url: string; normalized: string } {
  if (kind === "github_releases") {
    const { owner, repo } = parseGithubRepo(url);
    const canonical = `https://github.com/${owner}/${repo}`;
    return { url: canonical, normalized: `${normalizeUrl(canonical)}#releases` };
  }
  const normalized = normalizeUrl(url);
  assertPublicUrl(normalized);
  return { url: normalized, normalized: kind === "rss" ? `${normalized}#feed` : normalized };
}

export async function createSource(input: z.infer<typeof SourceInput>, userId: string) {
  const { url, normalized } = normalizeSourceUrl(input.kind, input.url);
  const existing = await queryOne<{ id: string; name: string }>("select id, name from sources where normalized_url = $1", [normalized]);
  if (existing) return { duplicate: existing };
  const row = await queryOne<{ id: string }>(
    `insert into sources (name, kind, url, normalized_url, category, trust, refresh_interval_minutes, max_pages, crawl_depth, path_prefix, enabled, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
    [
      input.name,
      input.kind,
      url,
      normalized,
      input.category,
      input.trust,
      input.refresh_interval_minutes,
      input.kind === "url" ? 1 : input.max_pages,
      input.kind === "website" ? input.crawl_depth : 0,
      input.path_prefix || null,
      input.enabled,
      userId,
    ],
  );
  return { id: row!.id };
}

export async function updateSource(id: string, patch: z.infer<typeof SourcePatch>) {
  const fields: string[] = [];
  const values: unknown[] = [id];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    values.push(value);
    fields.push(`${key} = $${values.length}`);
  }
  if (!fields.length) return;
  await query(`update sources set ${fields.join(", ")} where id = $1`, values);
  // Trust is denormalised onto documents for sources that are later removed; keep it in sync.
  if (patch.trust) await query("update documents set trust = $2 where source_id = $1", [id, patch.trust]);
  if (patch.category) await query("update documents set category = $2 where source_id = $1", [id, patch.category]);
}

export async function listSources() {
  return query(
    `select s.*, coalesce(d.indexed, 0)::int as indexed_documents, coalesce(d.failed, 0)::int as failed_documents,
            coalesce(d.duplicates, 0)::int as duplicate_documents, d.last_changed_at,
            j.status as pending_job_status
     from sources s
     left join lateral (
       select count(*) filter (where status = 'indexed') as indexed, count(*) filter (where status in ('failed', 'blocked')) as failed,
              count(*) filter (where status = 'duplicate') as duplicates, max(last_changed_at) as last_changed_at
       from documents where source_id = s.id
     ) d on true
     left join lateral (
       select status from ingestion_jobs where source_id = s.id and status in ('queued', 'running') limit 1
     ) j on true
     order by s.created_at desc`,
  );
}
