import { Suspense, type ReactNode } from "react";

export const metadata = { title: "Knowledge admin" };

// Admin pages are client-rendered behind a session check; the boundary lets
// dynamic routes read their URL at request time.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="min-h-dvh bg-paper" />}>{children}</Suspense>;
}
