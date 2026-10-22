import { handle } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { processJobs } from "@/lib/ingestion/jobs";

export const maxDuration = 300;

/** Lets an editor run queued jobs now, without waiting for the worker or cron. */
export const POST = handle(async () => {
  await requireRole("editor");
  const result = await processJobs({ workerId: `admin-${crypto.randomUUID().slice(0, 8)}`, maxJobs: 5, timeBudgetMs: 240_000 });
  return Response.json(result);
});
