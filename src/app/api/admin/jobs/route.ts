import { handle } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { query } from "@/lib/db";

export const GET = handle(async (req: Request) => {
  await requireRole("viewer");
  const status = new URL(req.url).searchParams.get("status");
  const jobs = await query(
    `select j.*, s.name as source_name, d.canonical_url as document_url,
       (select coalesce(json_agg(e order by e.created_at desc), '[]'::json) from (
          select level, url, message, created_at from ingestion_events where job_id = j.id and level <> 'info' order by created_at desc limit 20
       ) e) as problems
     from ingestion_jobs j left join sources s on s.id = j.source_id left join documents d on d.id = j.document_id
     ${status ? "where j.status = $1" : ""}
     order by j.created_at desc limit 100`,
    status ? [status] : [],
  );
  return Response.json({ jobs });
});
