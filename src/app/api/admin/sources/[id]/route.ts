import { handle, jsonError } from "@/lib/api";
import { SourcePatch } from "@/lib/admin/schemas";
import { updateSource } from "@/lib/admin/sources";
import { requireRole } from "@/lib/auth/guard";
import { query, queryOne } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  await requireRole("viewer");
  const { id } = await params;
  const source = await queryOne("select * from sources where id = $1", [id]);
  if (!source) return jsonError("Source not found.", 404);
  const events = await query("select * from ingestion_events where source_id = $1 order by created_at desc limit 100", [id]);
  return Response.json({ source, events });
});

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  await requireRole("editor");
  const { id } = await params;
  const patch = SourcePatch.parse(await req.json());
  await updateSource(id, patch);
  return Response.json({ ok: true });
});

/** Removes the source and every document indexed from it, so it can no longer be retrieved. */
export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  await requireRole("admin");
  const { id } = await params;
  await query("delete from sources where id = $1", [id]);
  return Response.json({ ok: true });
});
