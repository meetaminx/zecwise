"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, timeAgo } from "@/components/admin/api";
import { Card, Notice, PageHeader, StatusBadge, inputClass } from "@/components/admin/ui";

type Doc = {
  id: string; title: string; canonical_url: string; status: string; trust: string; source_name: string | null; chunks: number; chars: number;
  last_success_at: string | null; last_changed_at: string | null; retrieved_at: string | null; published_at: string | null; version: number;
  error: string | null; injection_flags: string[];
};

const STATUSES = ["", "indexed", "failed", "blocked", "duplicate", "disabled", "pending"];

function Documents() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const searchParams = useSearchParams();
  const [source, setSource] = useState(() => searchParams.get("source") ?? "");
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ q, status, source, page: String(page) });
    adminFetch<{ documents: Doc[] }>(`/api/admin/documents?${params}`).then((d) => setDocs(d.documents)).catch((e) => setError(e.message));
  }, [q, status, source, page]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <>
      <PageHeader title="Documents" description="Every page ZecWise has fetched, with its indexing status and metadata. Search titles, URLs or full text." />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search documents…" className={`${inputClass} pl-9`} />
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} className={`${inputClass} w-auto`}>
          {STATUSES.map((s) => <option key={s} value={s}>{s || "All statuses"}</option>)}
        </select>
        {source && <button onClick={() => setSource("")} className="rounded-lg border border-line px-3 text-sm text-muted hover:bg-leaf-faint">Clear source filter ×</button>}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!docs ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-line text-left text-xs text-muted uppercase">
              <tr>
                <th className="px-4 py-2.5 font-medium">Document</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Passages</th>
                <th className="px-4 py-2.5 font-medium">Last success</th>
                <th className="px-4 py-2.5 font-medium">Changed</th>
              </tr>
            </thead>
            <tbody>
              {docs.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-muted">No documents match.</td></tr>}
              {docs.map((d) => (
                <tr key={d.id} className="border-b border-line align-top last:border-0 hover:bg-leaf-faint/60">
                  <td className="max-w-md px-4 py-3">
                    <Link href={`/admin/documents/${d.id}`} className="font-medium text-charcoal hover:underline">{d.title || "(untitled)"}</Link>
                    <p className="truncate text-xs text-subtle">{d.canonical_url}</p>
                    <p className="text-xs text-subtle">{d.source_name ?? "No source"} · {d.trust} · v{d.version}</p>
                    {d.error && <p className="mt-1 text-xs text-danger">{d.error}</p>}
                    {d.injection_flags?.length > 0 && <p className="mt-1 text-xs text-warn">Flagged: {d.injection_flags.join(", ")}</p>}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                  <td className="px-4 py-3 tabular-nums">{d.chunks}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{timeAgo(d.last_success_at)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{timeAgo(d.last_changed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <div className="mt-4 flex gap-2">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-line px-3 py-1.5 text-sm disabled:opacity-40">Previous</button>
        <button disabled={!docs || docs.length < 50} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-line px-3 py-1.5 text-sm disabled:opacity-40">Next</button>
      </div>
    </>
  );
}

export default function DocumentsPage() {
  return (
    <AdminShell>
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <Documents />
      </Suspense>
    </AdminShell>
  );
}
