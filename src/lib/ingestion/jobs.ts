import "server-only";
import { query, queryOne } from "@/lib/db";
import { errorMessage, log } from "@/lib/log";
import { refreshSource, reindexDocument, type RunStats } from "./pipeline";

export type JobRow = {
  id: string;
  kind: "source_refresh" | "document_reindex";
  source_id: string | null;
  document_id: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
};

/** Queues a refresh unless one is already pending for the source (enforced by a partial unique index). */
export async function enqueueSourceRefresh(sourceId: string, requestedBy: string | null = null): Promise<{ jobId: string | null; alreadyQueued: boolean }> {
  const row = await queryOne<{ id: string }>(
    `insert into ingestion_jobs (kind, source_id, requested_by) values ('source_refresh', $1, $2)
     on conflict do nothing returning id`,
    [sourceId, requestedBy],
  );
  return { jobId: row?.id ?? null, alreadyQueued: !row };
}

export async function enqueueDocumentReindex(documentId: string, requestedBy: string | null = null) {
  const row = await queryOne<{ id: string }>(
    `insert into ingestion_jobs (kind, document_id, requested_by) values ('document_reindex', $1, $2)
     on conflict do nothing returning id`,
    [documentId, requestedBy],
  );
  return { jobId: row?.id ?? null, alreadyQueued: !row };
}

/** Queues refreshes for enabled sources whose refresh interval has elapsed. */
export async function enqueueDueSources(): Promise<number> {
  const rows = await query<{ id: string }>(
    `insert into ingestion_jobs (kind, source_id)
     select 'source_refresh', s.id from sources s
     where s.enabled and s.next_run_at <= now()
     on conflict do nothing returning id`,
  );
  return rows.length;
}

/** Requeues jobs whose worker died mid-run (running for over 30 minutes). */
export async function recoverStaleJobs(): Promise<number> {
  const rows = await query(
    `update ingestion_jobs set status = 'queued', locked_by = null, run_after = now()
     where status = 'running' and started_at < now() - interval '30 minutes' returning id`,
  );
  return rows.length;
}

async function claimJob(workerId: string): Promise<JobRow | null> {
  return queryOne<JobRow>(
    `update ingestion_jobs set status = 'running', locked_by = $1, started_at = now(), attempts = attempts + 1, error = null
     where id = (
       select id from ingestion_jobs where status = 'queued' and run_after <= now()
       order by run_after limit 1 for update skip locked
     )
     returning id, kind, source_id, document_id, status, attempts, max_attempts`,
    [workerId],
  );
}

async function runJob(job: JobRow) {
  const started = Date.now();
  try {
    let stats: RunStats;
    if (job.kind === "source_refresh" && job.source_id) stats = await refreshSource(job.source_id, job.id);
    else if (job.kind === "document_reindex" && job.document_id) stats = await reindexDocument(job.document_id, job.id);
    else throw new Error("Job has no target");
    await query("update ingestion_jobs set status = 'succeeded', finished_at = now(), stats = $2, locked_by = null where id = $1", [job.id, JSON.stringify(stats)]);
    log("info", "ingest.job_succeeded", { jobId: job.id, kind: job.kind, ms: Date.now() - started, stats });
  } catch (err) {
    const message = errorMessage(err);
    const stats = (err as { stats?: RunStats }).stats ?? {};
    const retry = job.attempts < job.max_attempts;
    await query(
      `update ingestion_jobs set status = $2, finished_at = case when $2 = 'failed' then now() else null end, error = $3, stats = $4, locked_by = null,
         run_after = now() + make_interval(mins => $5) where id = $1`,
      [job.id, retry ? "queued" : "failed", message, JSON.stringify(stats), 5 * 2 ** (job.attempts - 1)],
    );
    log(retry ? "warn" : "error", "ingest.job_failed", { jobId: job.id, kind: job.kind, attempt: job.attempts, willRetry: retry, error: message });
  }
}

/**
 * Processes queued jobs until the queue is empty or the time budget runs out.
 * Safe to run from several workers at once: jobs are claimed with SKIP LOCKED.
 */
export async function processJobs({ workerId, maxJobs = 10, timeBudgetMs = 50_000 }: { workerId: string; maxJobs?: number; timeBudgetMs?: number }) {
  const deadline = Date.now() + timeBudgetMs;
  let processed = 0;
  await recoverStaleJobs();
  while (processed < maxJobs && Date.now() < deadline) {
    const job = await claimJob(workerId);
    if (!job) break;
    await runJob(job);
    processed++;
  }
  return { processed };
}
