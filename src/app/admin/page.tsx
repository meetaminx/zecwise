"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch } from "@/components/admin/api";
import { Card, Notice, PageHeader } from "@/components/admin/ui";

type Stats = {
  documents: Array<{ status: string; n: number }>;
  sources: { total: number; enabled: number; with_errors: number };
  jobs: Array<{ status: string; n: number }>;
  retrieval: { total_7d: number; kb_7d: number; live_7d: number; avg_sources: number };
  costs: Array<{ kind: string; provider: string; est_cost_usd: number; input_tokens: string; output_tokens: string; units: number; calls: number }>;
  feedback: { up: number; down: number };
  chunks: { total: number; embedded: number };
  features: { llm: boolean; database: boolean; liveSearch: boolean; liveSearchProvider: string; semanticSearch: boolean; auth: boolean };
};

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold text-charcoal tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-subtle">{hint}</p>}
    </Card>
  );
}

function Overview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    adminFetch<Stats>("/api/admin/stats").then(setStats).catch((e) => setError(e.message));
  }, []);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!stats) return <p className="text-sm text-muted">Loading…</p>;

  const doc = (s: string) => stats.documents.find((d) => d.status === s)?.n ?? 0;
  const job = (s: string) => stats.jobs.find((d) => d.status === s)?.n ?? 0;
  const totalCost = stats.costs.reduce((sum, c) => sum + (c.est_cost_usd ?? 0), 0);
  const f = stats.features;

  return (
    <>
      <PageHeader title="Overview" description="Indexing health, retrieval volume and provider usage for the ZecWise knowledge base." />
      <div className="mb-6 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {[
          ["AI model (Anthropic)", f.llm, "ANTHROPIC_API_KEY"],
          ["Live web search", f.liveSearch, f.liveSearch ? f.liveSearchProvider : "TAVILY_API_KEY or BRAVE_SEARCH_API_KEY"],
          ["Semantic search (Voyage embeddings)", f.semanticSearch, "VOYAGE_API_KEY — keyword search is used without it"],
        ].map(([label, ok, hint]) => (
          <div key={String(label)} className={`rounded-lg border px-3 py-2.5 ${ok ? "border-leaf/30 bg-leaf-faint" : "border-warn/20 bg-warn-soft"}`}>
            <p className={`font-medium ${ok ? "text-forest-800" : "text-warn"}`}>
              {ok ? "✓" : "!"} {label}
            </p>
            <p className="mt-0.5 text-xs text-muted">{ok ? `Configured${typeof hint === "string" && f.liveSearch && label === "Live web search" ? ` (${hint})` : ""}` : `Not configured: set ${hint}`}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Indexed documents" value={doc("indexed")} hint={`${stats.chunks.total} passages · ${stats.chunks.embedded} embedded`} />
        <Stat label="Failed or blocked" value={doc("failed") + doc("blocked")} hint={`${doc("duplicate")} duplicates detected`} />
        <Stat label="Sources" value={stats.sources.total} hint={`${stats.sources.enabled} enabled · ${stats.sources.with_errors} with errors`} />
        <Stat label="Jobs (30 days)" value={job("succeeded") + job("failed")} hint={`${job("failed")} failed · ${job("queued") + job("running")} pending`} />
        <Stat label="Retrievals (7 days)" value={stats.retrieval.total_7d} hint={`${stats.retrieval.kb_7d} knowledge base · ${stats.retrieval.live_7d} live search`} />
        <Stat label="Avg sources / answer" value={stats.retrieval.avg_sources.toFixed(1)} />
        <Stat label="Feedback (30 days)" value={`${stats.feedback.up} / ${stats.feedback.down}`} hint="Helpful / not helpful" />
        <Stat label="Est. provider cost (30 days)" value={`$${totalCost.toFixed(2)}`} hint="Estimate from token usage and a configurable price table" />
      </div>
      <Card className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs text-muted uppercase">
            <tr>
              <th className="px-4 py-2.5 font-medium">Usage (30 days)</th>
              <th className="px-4 py-2.5 font-medium">Calls</th>
              <th className="px-4 py-2.5 font-medium">Input tokens</th>
              <th className="px-4 py-2.5 font-medium">Output tokens</th>
              <th className="px-4 py-2.5 font-medium">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {stats.costs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-muted">No provider usage recorded yet.</td>
              </tr>
            )}
            {stats.costs.map((c) => (
              <tr key={`${c.kind}-${c.provider}`} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 capitalize">{c.kind} · {c.provider}</td>
                <td className="px-4 py-2.5 tabular-nums">{c.calls}</td>
                <td className="px-4 py-2.5 tabular-nums">{Number(c.input_tokens).toLocaleString()}</td>
                <td className="px-4 py-2.5 tabular-nums">{Number(c.output_tokens).toLocaleString()}</td>
                <td className="px-4 py-2.5 tabular-nums">${(c.est_cost_usd ?? 0).toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

export default function AdminHome() {
  return (
    <AdminShell>
      <Overview />
    </AdminShell>
  );
}
