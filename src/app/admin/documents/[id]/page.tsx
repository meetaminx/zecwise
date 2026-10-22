"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Ban, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AdminShell, canEdit, useAdminUser } from "@/components/admin/AdminShell";
import { adminFetch, timeAgo } from "@/components/admin/api";
import { Button, Card, Notice, PageHeader, StatusBadge } from "@/components/admin/ui";

type Detail = {
  document: Record<string, string | number | null | string[]> & { id: string; title: string; canonical_url: string; status: string; content_text: string; injection_flags: string[] };
  chunks: Array<{ id: string; ord: number; heading: string | null; content: string; token_estimate: number; embedded: boolean }>;
};

function DocumentDetail() {
  const user = useAdminUser();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [view, setView] = useState<"text" | "chunks">("text");
  const load = useCallback(() => adminFetch<Detail>(`/api/admin/documents/${id}`).then(setData).catch((e) => setMsg({ tone: "error", text: e.message })), [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, text: string) => {
    try {
      await fn();
      setMsg({ tone: "success", text });
      void load();
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    }
  };

  if (!data) return msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : <p className="text-sm text-muted">Loading…</p>;
  const d = data.document;
  const meta: Array<[string, unknown]> = [
    ["Source", d.source_name ?? "None"], ["Publisher", d.publisher], ["Author", d.author],
    ["Published", d.published_at ? new Date(String(d.published_at)).toLocaleDateString() : "unknown"],
    ["Last retrieved", timeAgo(d.retrieved_at as string)], ["Last success", timeAgo(d.last_success_at as string)],
    ["Content changed", timeAgo(d.last_changed_at as string)], ["Version", d.version], ["Trust", d.trust], ["Category", d.category],
    ["Content hash", typeof d.content_hash === "string" ? `${d.content_hash.slice(0, 16)}…` : "—"],
  ];

  return (
    <>
      <Link href="/admin/documents" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Documents</Link>
      <PageHeader
        title={d.title || "(untitled)"}
        actions={canEdit(user) && (
          <>
            <Button onClick={() => act(() => adminFetch(`/api/admin/documents/${id}/reindex`, { method: "POST" }), "Re-index queued. Process the queue from Sources, or wait for the worker.")}><RefreshCw className="h-3.5 w-3.5" /> Re-index</Button>
            <Button onClick={() => act(() => adminFetch(`/api/admin/documents/${id}`, { method: "PATCH", body: JSON.stringify({ disabled: d.status !== "disabled" }) }), d.status === "disabled" ? "Document re-enabled." : "Document excluded from retrieval.")}>
              <Ban className="h-3.5 w-3.5" /> {d.status === "disabled" ? "Enable" : "Disable"}
            </Button>
            {user.role === "admin" && (
              <Button variant="danger" onClick={() => window.confirm("Delete this document and its passages?") && act(() => adminFetch(`/api/admin/documents/${id}`, { method: "DELETE" }).then(() => router.push("/admin/documents")), "Deleted.")}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            )}
          </>
        )}
      />
      <a href={d.canonical_url} target="_blank" rel="noopener noreferrer" className="-mt-4 mb-5 block truncate text-sm text-forest-700 hover:underline">{d.canonical_url}</a>
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <div className="mb-4 flex flex-wrap items-center gap-2"><StatusBadge status={d.status} />{d.error && <span className="text-sm text-danger">{String(d.error)}</span>}</div>
      {d.duplicate_of_url && <div className="mb-4"><Notice tone="info">Duplicate of <a className="underline" href={String(d.duplicate_of_url)}>{String(d.duplicate_of_url)}</a>. Duplicates are not retrievable.</Notice></div>}
      {d.injection_flags?.length > 0 && <div className="mb-4"><Notice tone="warn">Instruction-like content detected ({d.injection_flags.join(", ")}). It is passed to the model as untrusted, flagged evidence and ranked lower.</Notice></div>}
      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <Card className="min-w-0 p-5">
          <div className="mb-3 flex gap-1 text-sm">
            {(["text", "chunks"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`rounded-md px-2.5 py-1 ${view === v ? "bg-leaf-soft text-forest-800" : "text-muted hover:bg-leaf-faint"}`}>
                {v === "text" ? "Extracted text" : `Passages (${data.chunks.length})`}
              </button>
            ))}
          </div>
          {view === "text" ? (
            <pre className="max-h-[70vh] overflow-auto text-[13px] leading-relaxed whitespace-pre-wrap text-ink">{d.content_text || "(no text extracted)"}</pre>
          ) : (
            <ol className="max-h-[70vh] space-y-3 overflow-auto">
              {data.chunks.map((c) => (
                <li key={c.id} className="rounded-lg border border-line p-3 text-[13px]">
                  <p className="mb-1 text-xs text-subtle">#{c.ord} · ~{c.token_estimate} tokens · {c.embedded ? "embedded" : "keyword only"}{c.heading ? ` · ${c.heading}` : ""}</p>
                  <p className="whitespace-pre-wrap text-ink">{c.content}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card className="h-fit p-5">
          <dl className="space-y-2.5 text-sm">
            {meta.map(([k, v]) => (
              <div key={k}><dt className="text-xs text-subtle">{k}</dt><dd className="break-words text-ink">{v == null || v === "" ? "—" : String(v)}</dd></div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}

export default function DocumentPage() {
  return (
    <AdminShell>
      <DocumentDetail />
    </AdminShell>
  );
}
