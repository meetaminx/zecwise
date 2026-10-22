import { handle } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { enqueueSourceRefresh } from "@/lib/ingestion/jobs";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const user = await requireRole("editor");
  const { id } = await params;
  const job = await enqueueSourceRefresh(id, user.id);
  return Response.json(job, { status: job.alreadyQueued ? 200 : 202 });
});
