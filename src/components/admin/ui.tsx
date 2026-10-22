import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-charcoal">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-surface ${className}`}>{children}</div>;
}

const STATUS_STYLE: Record<string, string> = {
  indexed: "bg-leaf-soft text-forest-800",
  succeeded: "bg-leaf-soft text-forest-800",
  running: "bg-[#e6eef6] text-[#24527a]",
  queued: "bg-[#eef0ea] text-muted",
  pending: "bg-[#eef0ea] text-muted",
  duplicate: "bg-[#f1efe8] text-muted",
  disabled: "bg-[#f1efe8] text-muted",
  blocked: "bg-warn-soft text-warn",
  failed: "bg-danger-soft text-danger",
  cancelled: "bg-[#f1efe8] text-muted",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLE[status] ?? "bg-[#eef0ea] text-muted"}`}>{status}</span>;
}

export function Button({ children, variant = "secondary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-forest-700 text-white hover:bg-forest-800 border-transparent",
    secondary: "bg-surface text-ink border-line-strong hover:bg-leaf-faint",
    danger: "bg-surface text-danger border-danger/30 hover:bg-danger-soft",
  }[variant];
  return (
    <button {...props} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${props.className ?? ""}`}>
      {children}
    </button>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "success"; children: ReactNode }) {
  const styles = {
    info: "border-line bg-leaf-faint text-ink",
    warn: "border-warn/20 bg-warn-soft text-warn",
    error: "border-danger/20 bg-danger-soft text-danger",
    success: "border-leaf/30 bg-leaf-soft text-forest-800",
  }[tone];
  return <div className={`rounded-lg border px-3.5 py-2.5 text-sm ${styles}`}>{children}</div>;
}

export const inputClass =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-subtle focus:border-forest-600 focus:outline-none";
