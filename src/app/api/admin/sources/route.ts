import { handle, jsonError } from "@/lib/api";
import { SourceInput } from "@/lib/admin/schemas";
import { createSource, listSources } from "@/lib/admin/sources";
import { requireRole } from "@/lib/auth/guard";
import { enqueueSourceRefresh } from "@/lib/ingestion/jobs";
import { errorMessage } from "@/lib/log";

export const GET = handle(async () => {
  await requireRole("viewer");
  return Response.json({ sources: await listSources() });
});

/** Registers a source and queues its first ingestion. The source is not "indexed" until a job succeeds. */
export const POST = handle(async (req: Request) => {
  const user = await requireRole("editor");
  const input = SourceInput.parse(await req.json());
  let result;
  try {
    result = await createSource(input, user.id);
  } catch (err) {
    return jsonError(errorMessage(err), 400);
  }
  if ("duplicate" in result && result.duplicate) return jsonError(`This source is already registered as "${result.duplicate.name}".`, 409);
  const job = input.enabled ? await enqueueSourceRefresh(result.id!, user.id) : null;
  return Response.json({ id: result.id, jobId: job?.jobId ?? null }, { status: 201 });
});
