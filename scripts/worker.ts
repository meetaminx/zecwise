import "dotenv/config";
import { enqueueDueSources, processJobs } from "../src/lib/ingestion/jobs";
import { getPool } from "../src/lib/db";

/**
 * Long-running ingestion worker: every POLL seconds it queues sources whose
 * refresh interval has elapsed and works the queue. Run several for throughput;
 * jobs are claimed with SKIP LOCKED. `--once` drains the queue and exits.
 */
const POLL_MS = Number(process.env.WORKER_POLL_SECONDS ?? 60) * 1000;
const once = process.argv.includes("--once");
const workerId = `worker-${process.pid}`;
let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

async function tick() {
  const queued = await enqueueDueSources();
  const { processed } = await processJobs({ workerId, maxJobs: 50, timeBudgetMs: 15 * 60_000 });
  if (queued || processed) console.log(JSON.stringify({ t: new Date().toISOString(), event: "worker.tick", queued, processed }));
  return processed;
}

async function main() {
  console.log(`${workerId} started${once ? " (once)" : ""}`);
  do {
    try {
      const processed = await tick();
      if (once && processed === 0) break;
    } catch (err) {
      console.error("worker tick failed", err);
    }
    if (!once) await new Promise((r) => setTimeout(r, POLL_MS));
  } while (!stopping);
  await getPool().end();
}

main();
