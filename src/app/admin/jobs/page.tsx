"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, timeAgo } from "@/components/admin/api";
import { Card, Notice, PageHeader, StatusBadge } from "@/components/admin/ui";

type Job = {
  id: string; kind: string; status: string; attempts: number; max_attempts: number; source_name: string | null; document_url: string | null;
  created_at: string; started_at: string | null; finished_at: string | null; run_after: string; error: string | null; stats: Record<string, number>;
  problems: Array<{ level: string; url: string | null; message: string; created_at: string }>;
};

const FILTERS = ["", "failed", "queued", "running", "succeeded"];

function Jobs() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [status, setStatus] = useState("failed");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => adminFetch<{ jobs: Job[] }>(`/api/admin/jobs${status ? `?status=${status}` : ""}`).then((d) => setJobs(d.jobs)).catch((e) => setError(e.message)), [status]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <>
      <PageHeader title="Ingestion jobs" description="Background refreshes and re-index requests. Failed jobs are retried with backoff before being marked failed." />
      <div className="mb-4 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setStatus(f)} className={`rounded-md px-3 py-1.5 text-sm ${status === f ? "bg-forest-700 text-white" : "border border-line bg-surface text-muted hover:bg-leaf-faint"}`}>
            {f || "All"}
          </button>
        ))}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!jobs ? <p className="text-sm text-muted">Loading…</p> : jobs.length === 0 ? <Card className="p-6 text-sm text-muted">No {status || ""} jobs.</Card> : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <Card key={j.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={j.status} />
                <span className="font-medium text-charcoal">{j.kind === "source_refresh" ? j.source_name ?? "Deleted source" : "Re-index document"}</span>
                <span className="text-xs text-subtle">attempt {j.attempts}/{j.max_attempts} · created {timeAgo(j.created_at)}{j.finished_at ? ` · finished ${timeAgo(j.finished_at)}` : ""}{j.status === "queued" ? ` · runs ${timeAgo(j.run_after)}` : ""}</span>
              </div>
              {j.document_url && <p className="mt-1 truncate text-xs text-subtle">{j.document_url}</p>}
              {j.error && <p className="mt-2 rounded-md bg-danger-soft px-2.5 py-1.5 text-xs text-danger">{j.error}</p>}
              {j.stats && Object.keys(j.stats).length > 0 && (
                <p className="mt-2 text-xs text-muted">{Object.entries(j.stats).filter(([, v]) => v).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(" · ")}</p>
              )}
              {j.problems?.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-muted">{j.problems.length} warning(s) and error(s)</summary>
                  <ul className="mt-2 space-y-1 text-xs">
                    {j.problems.map((p, i) => (
                      <li key={i} className={p.level === "error" ? "text-danger" : "text-warn"}>
                        {p.url && <span className="text-subtle">{p.url} — </span>}{p.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export default function JobsPage() {
  return (
    <AdminShell>
      <Jobs />
    </AdminShell>
  );
}
