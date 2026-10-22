"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, use, useEffect, useState, type ReactNode } from "react";
import { Activity, FileText, Gauge, LogOut, MessagesSquare, Rss } from "lucide-react";
import { Logo } from "@/components/ui/Logo";

const NAV = [
  { href: "/admin", label: "Overview", icon: Gauge },
  { href: "/admin/sources", label: "Sources", icon: Rss },
  { href: "/admin/documents", label: "Documents", icon: FileText },
  { href: "/admin/jobs", label: "Ingestion jobs", icon: Activity },
];

export type AdminUser = { email: string; role: "admin" | "editor" | "viewer" };

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AdminUser | null>(null);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d.user) router.replace(`/admin/login?next=${encodeURIComponent(window.location.pathname)}`);
        else setUser(d.user);
      })
      .catch(() => undefined);
  }, [router]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/admin/login");
  };

  return (
    <div className="flex min-h-dvh flex-col bg-paper md:flex-row">
      <aside className="flex shrink-0 flex-col bg-forest-900 text-white/85 md:w-60">
        <div className="flex items-center justify-between px-5 py-4 md:block">
          <Link href="/admin">
            <Logo />
          </Link>
          <p className="text-[11px] tracking-wider text-white/40 uppercase md:mt-1">Knowledge admin</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={`flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm ${active ? "bg-white/[0.1] text-white" : "hover:bg-white/[0.06] hover:text-white"}`}>
                <Icon className="h-4 w-4" /> {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto hidden border-t border-white/10 px-3 py-3 text-sm md:block">
          <Link href="/" className="flex items-center gap-2.5 rounded-md px-2.5 py-2 hover:bg-white/[0.06]">
            <MessagesSquare className="h-4 w-4" /> Back to chat
          </Link>
          {user && (
            <div className="mt-2 px-2.5">
              <p className="truncate text-xs text-white/60">{user.email}</p>
              <p className="text-[11px] text-white/40 capitalize">{user.role}</p>
              <button onClick={logout} className="mt-2 flex items-center gap-1.5 text-xs text-white/60 hover:text-white">
                <LogOut className="h-3.5 w-3.5" /> Sign out
              </button>
            </div>
          )}
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">{user ? <UserContext value={user}>{children}</UserContext> : <p className="text-sm text-muted">Checking your session…</p>}</main>
    </div>
  );
}

const UserContext = createContext<AdminUser | null>(null);
export function useAdminUser(): AdminUser {
  return use(UserContext)!;
}
export function canEdit(user: AdminUser) {
  return user.role === "admin" || user.role === "editor";
}
