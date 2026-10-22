import "server-only";
import { cookies } from "next/headers";

const VISITOR_COOKIE = "zw_vid";

/**
 * Chat visitors are anonymous. Conversations are scoped to an opaque random id in
 * an httpOnly cookie, so one visitor cannot list or read another's history.
 */
export async function getVisitorId({ create }: { create: boolean }): Promise<string | null> {
  const store = await cookies();
  const existing = store.get(VISITOR_COOKIE)?.value;
  if (existing && /^[a-f0-9-]{36}$/.test(existing)) return existing;
  if (!create) return null;
  const id = crypto.randomUUID();
  store.set(VISITOR_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return id;
}
