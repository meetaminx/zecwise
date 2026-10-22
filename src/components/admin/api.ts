"use client";

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Fetch wrapper for admin API routes; a 401 sends the user to sign in. */
export async function adminFetch<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  if (res.status === 401) {
    // A full navigation is intended here: it drops any stale admin state after the session expired.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/admin/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new AdminApiError("Sign in required", 401);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AdminApiError(data.error ?? `Request failed (HTTP ${res.status})`, res.status);
  return data as T;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) return `in ${fmt(-s)}`;
  return `${fmt(s)} ago`;
}

function fmt(s: number) {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
