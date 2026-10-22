"use client";

import { Pause, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AdminShell, canEdit, useAdminUser } from "@/components/admin/AdminShell";
import { adminFetch, timeAgo } from "@/components/admin/api";
import { Button, Card, Notice, PageHeader, StatusBadge, inputClass } from "@/components/admin/ui";

type SourceRow = {
  id: string; name: string; kind: string; url: string; category: string; trust: string; enabled: boolean;
  refresh_interval_minutes: number; max_pages: number; crawl_depth: number; last_run_at: string | null; last_success_at: string | null;
  last_error: string | null; next_run_at: string; indexed_documents: number; failed_documents: number; duplicate_documents: number;
  last_changed_at: string | null; pending_job_status: string | null;
};

const KINDS = [
  { value: "url", label: "Single page", hint: "Fetch one URL." },
  { value: "website", label: "Website section", hint: "Crawl same-site links under this path, up to the page limit." },
  { value: "rss", label: "RSS / Atom feed", hint: "Index each feed item's page (or its feed text if the page can't be fetched)." },
  { value: "github_releases", label: "GitHub releases", hint: "owner/repo — uses the GitHub REST API." },
];
const TRUST = ["official", "primary", "reputable", "community", "unverified"];
const CATEGORIES = ["documentation", "specification", "github", "research", "wallet", "news", "blog", "community"];
const INTERVALS = [
  [60, "Hourly"], [360, "Every 6 hours"], [1440, "Daily"], [10080, "Weekly"], [43200, "Monthly"],
] as const;

function AddSource({ onAdded }: { onAdded: (msg: string) => void }) {
  const [kind, setKind] = useState("url");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await adminFetch("/api/admin/sources", {
        method: "POST",
        body: JSON.stringify({
          name: f.get("name"), kind, url: f.get("url"), category: f.get("category"), trust: f.get("trust"),
          refresh_interval_minutes: Number(f.get("interval")), max_pages: Number(f.get("max_pages") || 25), crawl_depth: Number(f.get("crawl_depth") || 1),
          path_prefix: f.get("path_prefix") || null,
        }),
      });
      (e.target as HTMLFormElement).reset();
      onAdded("Source registered and queued for ingestion. It will show documents once the ingestion job succeeds.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="mb-6 p-5">
      <h2 className="text-sm font-semibold text-charcoal">Add a source</h2>
      <p className="mt-0.5 text-xs text-muted">Only add sources you are permitted to index. robots.txt rules, noindex tags and rate limits are respected automatically.</p>
      <form onSubmit={submit} className="mt-4 grid gap-3 md:grid-cols-6">
        <div className="md:col-span-2">
          <label className="text-xs font-medium text-muted">Type</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={`${inputClass} mt-1`}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-subtle">{KINDS.find((k) => k.value === kind)?.hint}</p>
        </div>
        <div className="md:col-span-4">
          <label className="text-xs font-medium text-muted">{kind === "github_releases" ? "Repository" : "URL"}</label>
          <input name="url" required placeholder={kind === "github_releases" ? "zcash/zcash" : "https://"} className={`${inputClass} mt-1`} />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-medium text-muted">Name</label>
          <input name="name" required placeholder="e.g. Zcash protocol docs" className={`${inputClass} mt-1`} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted">Category</label>
          <select name="category" className={`${inputClass} mt-1`}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted">Trust</label>
          <select name="trust" defaultValue="unverified" className={`${inputClass} mt-1`}>{TRUST.map((t) => <option key={t}>{t}</option>)}</select>
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-medium text-muted">Refresh</label>
          <select name="interval" defaultValue={1440} className={`${inputClass} mt-1`}>{INTERVALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </div>
        {kind !== "url" && (
          <div>
            <label className="text-xs font-medium text-muted">Max pages / items</label>
            <input name="max_pages" type="number" min={1} max={500} defaultValue={25} className={`${inputClass} mt-1`} />
          </div>
        )}
        {kind === "website" && (
          <>
            <div>
              <label className="text-xs font-medium text-muted">Link depth</label>
              <input name="crawl_depth" type="number" min={0} max={3} defaultValue={1} className={`${inputClass} mt-1`} />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-muted">Path prefix (optional)</label>
              <input name="path_prefix" placeholder="/docs" className={`${inputClass} mt-1`} />
            </div>
          </>
        )}
        <div className="flex items-end md:col-span-6">
          <Button variant="primary" disabled={busy}>
            <Plus className="h-4 w-4" /> {busy ? "Adding…" : "Add and queue ingestion"}
          </Button>
        </div>
        {error && <div className="md:col-span-6"><Notice tone="error">{error}</Notice></div>}
      </form>
    </Card>
  );
}

function Sources() {
  const user = useAdminUser();
  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(() => adminFetch<{ sources: SourceRow[] }>("/api/admin/sources").then((d) => setSources(d.sources)).catch((e) => setMessage({ tone: "error", text: e.message })), []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMessage({ tone: "success", text: ok });
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    }
    void load();
  };

  const patch = (id: string, body: Record<string, unknown>, ok: string) => act(() => adminFetch(`/api/admin/sources/${id}`, { method: "PATCH", body: JSON.stringify(body) }), ok);

  const runNow = async () => {
    setRunning(true);
    await act(() => adminFetch<{ processed: number }>("/api/admin/process", { method: "POST" }).then((r) => setMessage({ tone: "success", text: `Processed ${r.processed} job(s).` })), "Queue processed.");
    setRunning(false);
  };

  const editor = canEdit(user);

  return (
    <>
      <PageHeader
        title="Sources"
        description="Approved websites, feeds and repositories ZecWise may index. Disabled sources are excluded from retrieval immediately."
        actions={editor && <Button onClick={runNow} disabled={running}><RefreshCw className={`h-4 w-4 ${running ? "animate-spin" : ""}`} /> {running ? "Processing…" : "Process queue now"}</Button>}
      />
      {message && <div className="mb-4"><Notice tone={message.tone}>{message.text}</Notice></div>}
      {editor && <AddSource onAdded={(t) => { setMessage({ tone: "success", text: t }); void load(); }} />}
      {!sources ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : sources.length === 0 ? (
        <Card className="p-6 text-sm text-muted">No sources yet. Add one above, or run <code>npm run seed:sources</code> to register the starter set.</Card>
      ) : (
        <div className="space-y-3">
          {sources.map((s) => (
            <Card key={s.id} className={`p-4 ${s.enabled ? "" : "opacity-70"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-charcoal">{s.name}</h3>
                    {!s.enabled && <StatusBadge status="disabled" />}
                    {s.pending_job_status && <StatusBadge status={s.pending_job_status} />}
                    <span className="text-xs text-subtle">{KINDS.find((k) => k.value === s.kind)?.label} · {s.category}</span>
                  </div>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 block truncate text-xs text-forest-700 hover:underline">{s.url}</a>
                </div>
                {editor && (
                  <div className="flex flex-wrap gap-1.5">
                    <Button onClick={() => act(() => adminFetch(`/api/admin/sources/${s.id}/reindex`, { method: "POST" }), "Re-index queued.")} disabled={!s.enabled || !!s.pending_job_status}>
                      <RefreshCw className="h-3.5 w-3.5" /> Re-index
                    </Button>
                    <Button onClick={() => patch(s.id, { enabled: !s.enabled }, s.enabled ? "Source disabled; its documents are excluded from retrieval." : "Source enabled.")}>
                      {s.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} {s.enabled ? "Disable" : "Enable"}
                    </Button>
                    {user.role === "admin" && (
                      <Button variant="danger" onClick={() => confirmDelete(s, () => act(() => adminFetch(`/api/admin/sources/${s.id}`, { method: "DELETE" }), "Source and its documents removed."))}>
                        <Trash2 className="h-3.5 w-3.5" /> Remove
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4 lg:grid-cols-6">
                <div><dt className="text-subtle">Indexed docs</dt><dd className="font-medium text-ink tabular-nums">{s.indexed_documents}</dd></div>
                <div><dt className="text-subtle">Failed / dupes</dt><dd className="font-medium text-ink tabular-nums">{s.failed_documents} / {s.duplicate_documents}</dd></div>
                <div><dt className="text-subtle">Last success</dt><dd className="text-ink">{timeAgo(s.last_success_at)}</dd></div>
                <div><dt className="text-subtle">Content changed</dt><dd className="text-ink">{timeAgo(s.last_changed_at)}</dd></div>
                <div><dt className="text-subtle">Next refresh</dt><dd className="text-ink">{s.enabled ? timeAgo(s.next_run_at) : "—"}</dd></div>
                <div>
                  <dt className="text-subtle">Trust</dt>
                  <dd>
                    {editor ? (
                      <select value={s.trust} onChange={(e) => patch(s.id, { trust: e.target.value }, "Trust classification updated.")} className="rounded border border-line bg-surface px-1 py-0.5 text-xs">
                        {TRUST.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    ) : s.trust}
                  </dd>
                </div>
                <div>
                  <dt className="text-subtle">Refresh</dt>
                  <dd>
                    {editor ? (
                      <select value={s.refresh_interval_minutes} onChange={(e) => patch(s.id, { refresh_interval_minutes: Number(e.target.value) }, "Refresh interval updated.")} className="rounded border border-line bg-surface px-1 py-0.5 text-xs">
                        {INTERVALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        {!INTERVALS.some(([v]) => v === s.refresh_interval_minutes) && <option value={s.refresh_interval_minutes}>{s.refresh_interval_minutes} min</option>}
                      </select>
                    ) : `${s.refresh_interval_minutes} min`}
                  </dd>
                </div>
                <div><dt className="text-subtle">Documents</dt><dd><a className="text-forest-700 hover:underline" href={`/admin/documents?source=${s.id}`}>View</a></dd></div>
              </dl>
              {s.last_error && <p className="mt-3 rounded-md bg-danger-soft px-2.5 py-1.5 text-xs text-danger">Last error: {s.last_error}</p>}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function confirmDelete(s: SourceRow, run: () => void) {
  // A native confirm is fine for an admin-only destructive action.
  if (window.confirm(`Remove "${s.name}" and all ${s.indexed_documents} of its indexed documents? This cannot be undone.`)) run();
}

export default function SourcesPage() {
  return (
    <AdminShell>
      <Sources />
    </AdminShell>
  );
}
