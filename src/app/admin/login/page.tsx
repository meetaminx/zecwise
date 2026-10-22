"use client";

import { useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { inputClass } from "@/components/admin/ui";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Sign-in failed.");
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.href = next && next.startsWith("/admin") ? next : "/admin";
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-forest-900 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <form onSubmit={submit} className="rounded-2xl bg-surface p-6 shadow-xl">
          <h1 className="text-lg font-semibold text-charcoal">Sign in to the knowledge admin</h1>
          <p className="mt-1 text-sm text-muted">For ZecWise administrators and editors.</p>
          <label className="mt-5 block text-sm font-medium text-ink" htmlFor="email">
            Email
          </label>
          <input id="email" name="email" type="email" autoComplete="username" required className={`${inputClass} mt-1`} />
          <label className="mt-4 block text-sm font-medium text-ink" htmlFor="password">
            Password
          </label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className={`${inputClass} mt-1`} />
          {error && (
            <p className="mt-3 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <button disabled={busy} className="mt-5 w-full rounded-lg bg-forest-700 py-2.5 text-sm font-medium text-white hover:bg-forest-800 disabled:opacity-60">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
