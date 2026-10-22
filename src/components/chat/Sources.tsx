import { ExternalLink, Globe, Library } from "lucide-react";
import type { Source, Trust } from "./types";

export const TRUST_LABEL: Record<Trust, string> = {
  official: "Official",
  primary: "Primary source",
  reputable: "Reputable",
  community: "Community",
  unverified: "Unverified",
};

const TRUST_STYLE: Record<Trust, string> = {
  official: "bg-leaf-soft text-forest-800",
  primary: "bg-leaf-soft text-forest-800",
  reputable: "bg-[#eef1ea] text-ink",
  community: "bg-[#f1efe8] text-muted",
  unverified: "bg-warn-soft text-warn",
};

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function formatDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function SourceCard({ source }: { source: Source }) {
  const date = formatDate(source.publishedAt);
  return (
    <a
      id={`src-${source.ref}`}
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex min-w-0 flex-col gap-1.5 rounded-xl border border-line bg-surface p-3 transition hover:border-forest-600/40 hover:bg-leaf-faint"
    >
      <div className="flex items-center gap-2 text-[11px] text-muted">
        <span className="flex h-5 min-w-5 items-center justify-center rounded bg-forest-800 px-1 text-[10px] font-semibold text-white">{source.ref}</span>
        {source.kind === "web" ? <Globe className="h-3 w-3" aria-label="Live web result" /> : <Library className="h-3 w-3" aria-label="Knowledge base" />}
        <span className="truncate">{source.publisher || hostOf(source.url)}</span>
        <ExternalLink className="ml-auto h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-100" />
      </div>
      <p className="line-clamp-2 text-[13px] font-medium leading-snug text-charcoal">{source.title}</p>
      <div className="mt-auto flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={`rounded px-1.5 py-0.5 font-medium ${TRUST_STYLE[source.trust]}`}>{TRUST_LABEL[source.trust]}</span>
        {date && <span className="text-subtle">{date}</span>}
      </div>
    </a>
  );
}

/** Cited sources first; sources that were retrieved but not cited are shown as related reading. */
export function SourceList({ sources, done }: { sources: Source[]; done: boolean }) {
  if (!sources.length) return null;
  const cited = done ? sources.filter((s) => s.cited) : sources;
  const related = done ? sources.filter((s) => !s.cited) : [];
  return (
    <div className="mt-5 space-y-4">
      {cited.length > 0 && (
        <section aria-label="Sources">
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{done ? "Sources" : "Reading sources"}</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">{cited.map((s) => <SourceCard key={s.ref} source={s} />)}</div>
        </section>
      )}
      {related.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none text-xs font-semibold tracking-wide text-muted uppercase select-none hover:text-ink">
            Related reading ({related.length}) <span className="font-normal normal-case text-subtle group-open:hidden">· show</span>
          </summary>
          <ul className="mt-2 space-y-1.5">
            {related.map((s) => (
              <li key={s.ref} className="flex items-baseline gap-2 text-sm">
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="truncate text-forest-700 underline decoration-line-strong underline-offset-2 hover:decoration-forest-600">
                  {s.title}
                </a>
                <span className="shrink-0 text-xs text-subtle">{hostOf(s.url)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
