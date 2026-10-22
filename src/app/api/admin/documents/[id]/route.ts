import { z } from "zod";
import { handle, jsonError } from "@/lib/api";
import { TRUST_LEVELS } from "@/lib/admin/schemas";
import { requireRole } from "@/lib/auth/guard";
import { query, queryOne } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  await requireRole("viewer");
  const { id } = await params;
  const document = await queryOne(
    `select d.*, s.name as source_name, dup.canonical_url as duplicate_of_url
     from documents d left join sources s on s.id = d.source_id left join documents dup on dup.id = d.duplicate_of where d.id = $1`,
    [id],
  );
  if (!document) return jsonError("Document not found.", 404);
  const chunks = await query("select id, ord, heading, content, token_estimate, embedding is not null as embedded from chunks where document_id = $1 order by ord", [id]);
  return Response.json({ document, chunks });
});

/** Disable (exclude from retrieval), re-enable, or change trust for a single document. */
export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  await requireRole("editor");
  const { id } = await params;
  const body = z.object({ disabled: z.boolean().optional(), trust: z.enum(TRUST_LEVELS).optional() }).parse(await req.json());
  if (body.disabled === true) await query("update documents set status = 'disabled', updated_at = now() where id = $1", [id]);
  if (body.disabled === false)
    await query(
      "update documents set status = case when exists (select 1 from chunks where document_id = $1) then 'indexed' else 'pending' end, updated_at = now() where id = $1 and status = 'disabled'",
      [id],
    );
  if (body.trust) await query("update documents set trust = $2, updated_at = now() where id = $1", [id, body.trust]);
  return Response.json({ ok: true });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  await requireRole("admin");
  const { id } = await params;
  await query("delete from documents where id = $1", [id]);
  return Response.json({ ok: true });
});
