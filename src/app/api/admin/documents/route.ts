import { handle } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { query } from "@/lib/db";

/** Lists and searches indexed documents (title, URL, or full text). */
export const GET = handle(async (req: Request) => {
  await requireRole("viewer");
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const status = url.searchParams.get("status") ?? "";
  const sourceId = url.searchParams.get("source") ?? "";
  const page = Math.max(0, Number(url.searchParams.get("page") ?? 0));
  const params: unknown[] = [];
  const where: string[] = [];
  if (q) {
    params.push(`%${q}%`, q);
    where.push(`(d.title ilike $${params.length - 1} or d.canonical_url ilike $${params.length - 1} or to_tsvector('english', d.content_text) @@ websearch_to_tsquery('english', $${params.length}))`);
  }
  if (status) {
    params.push(status);
    where.push(`d.status = $${params.length}`);
  }
  if (sourceId) {
    params.push(sourceId);
    where.push(`d.source_id = $${params.length}`);
  }
  params.push(page * 50);
  const rows = await query(
    `select d.id, d.title, d.canonical_url, d.publisher, d.published_at, d.retrieved_at, d.last_success_at, d.last_changed_at,
            d.status, d.trust, d.category, d.version, d.error, d.injection_flags, d.duplicate_of, length(d.content_text) as chars,
            s.name as source_name, s.id as source_id, (select count(*)::int from chunks c where c.document_id = d.id) as chunks
     from documents d left join sources s on s.id = d.source_id
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by d.updated_at desc limit 50 offset $${params.length}`,
    params,
  );
  return Response.json({ documents: rows, page });
});
