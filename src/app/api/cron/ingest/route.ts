import { timingSafeEqual } from "node:crypto";
import { handle, jsonError } from "@/lib/api";
import { config } from "@/lib/config";
import { enqueueDueSources, processJobs } from "@/lib/ingestion/jobs";

export const maxDuration = 300;

function authorized(req: Request): boolean {
  if (!config.cronSecret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${config.cronSecret}`;
  return header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

/**
 * Scheduled ingestion entry point (e.g. Vercel Cron or any scheduler sending
 * `Authorization: Bearer $CRON_SECRET`). Queues due sources, then works the queue
 * within the function's time budget. Long backfills should use `npm run worker`.
 */
async function run(req: Request) {
  if (!authorized(req)) return jsonError("Unauthorized.", 401);
  const queued = await enqueueDueSources();
  const result = await processJobs({ workerId: `cron-${crypto.randomUUID().slice(0, 8)}`, maxJobs: 20, timeBudgetMs: 240_000 });
  return Response.json({ queued, ...result });
}

export const GET = handle(run);
export const POST = handle(run);
